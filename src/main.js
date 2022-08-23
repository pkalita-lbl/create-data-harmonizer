#!/usr/bin/env node

import path from 'path'
import { mkdir, readdir, copyFile, writeFile } from 'fs/promises'
import { SchemaView } from 'linkml-js'
import minimist from 'minimist'
import inquirer from 'inquirer'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import { spawn, exec } from 'child_process'

const DH_INTERFACE = "dh_interface"
const TEMPLATE_DIR = path.resolve(fileURLToPath(import.meta.url), '../../template')

function err(msg) {
  console.error(chalk.red(msg))
  process.exit(1)
}

async function run(schemaPath) {
  try {
    await new Promise((resolve, reject) => {
      exec('npm --version', (err, stdout) => {
        if (err) {
          reject(err)
        }
        resolve(stdout)
      })
    })
  } catch {
    err('`npm` not found')
  }

  schemaPath = path.resolve(schemaPath)
  console.log(`Reading schema file ${chalk.green(schemaPath)}\n`)

  const view = await SchemaView.load(schemaPath, true)
  await view.mergeImports()
  
  const allClasses = view.allClasses()
  for (const [className, classDef] of allClasses) {
    const attrs = view.classInducedSlots(className)
    if (attrs && attrs.length && !classDef.attributes) {
      classDef.attributes = {}
    }
    for (const attr of attrs) {
      classDef.attributes[attr.name] = attr
    }
  }
  
  const questions = [
    {
      type: 'input',
      name: 'projectName',
      message: 'What would you like your new project to be called?'
    },
    {
      type: 'checkbox',
      name: 'classes',
      message: 'The following classes were found in the provided schema. Which should be used as DataHarmonizer templates?',
      choices: Array.from(view.allClasses().keys())
        .filter(name => name !== DH_INTERFACE)
        .map(name => ({
          name: name,
          checked: view.classAncestors(name).includes(DH_INTERFACE)
        })),
      loop: false
    }
  ]

  const answers = await inquirer.prompt(questions)
  
  if (answers.classes.length === 0) {
    err('No classes selected. Project will not be generated')
  }

  const dest = path.join(process.cwd(), answers.projectName)
  console.log(`\nCreating new data-harmonizer project in ${chalk.green(dest)}\n`)

  try {
    await mkdir(dest, { recursive: true })
  } catch {
    err(`Could not create directory ${dest}`)
  }

  try {
    const templateFiles = await readdir(TEMPLATE_DIR)
    for (const templateFile of templateFiles) {
      const srcFile = path.join(TEMPLATE_DIR, templateFile)
      const fname = templateFile.replace('_gitignore', '.gitignore')
      const destFile = path.join(dest, fname)
      await copyFile(srcFile, destFile)
    }
  } catch {
    err(`Could not copy template files to ${dest}`)
  }

  const pkgJson = {
    name: "dh-testing-web",
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "vite build",
      preview: "vite preview"
    },
    private: true,
    devDependencies: {
      "vite": "3.0.4"
    },
    dependencies: {
      bootstrap: "4.3.1",
      "data-harmonizer": "1.3.5",
      jquery: "3.5.1",
      "popper.js": "1.16.1"
    }
  }
  try {
    await writeFile(path.join(dest, 'package.json'), JSON.stringify(pkgJson, null, 2))
  } catch {
    err(`Could not write package.json to ${dest}`)
  }

  const schemasDir = path.join(dest, 'schemas')
  try {
    await mkdir(schemasDir, { recursive: true })
  } catch {
    err(`Could not create directory: ${schemasDir}`)
  }

  const schemaPathParsed = path.parse(schemaPath)
  const schemaJsonPath = path.join(schemasDir, schemaPathParsed.name + '.json')
  try {
    await writeFile(schemaJsonPath, JSON.stringify(view.schema, null, 2))
  } catch {
    err(`Could not export schema to ${schemaJsonPath}`)
  }

  const menuJson = {
    [schemaPathParsed.name]: answers.classes.reduce((prev, curr) => {
      return {
        ...prev,
        [curr]: {
          name: curr,
          status: "published",
          display: true,
        } 
      }
    }, {})
  }
  try {
    await writeFile(path.join(dest, 'menu.json'), JSON.stringify(menuJson, null, 2))
  } catch {
    err(`Could not write menu.json to ${dest}`)
  }

  console.log('Installing dependencies')
  const npm = spawn('npm', ['install'], {
    cwd: dest
  })
  npm.stdout.pipe(process.stdout)
  npm.stderr.pipe(process.stderr)
  npm.on('close', (code) => {
    if (code > 0) {
      err('Error while installing dependencies')
    }
    console.log(`
${chalk.green('Success!')} Created project at ${dest}
Inside that directory, you can run several commands:

  ${chalk.cyan('npm run dev')}
    Start the development server.

  ${chalk.cyan('npm run build')}
    Bundle the app into static files for production.

  ${chalk.cyan('npm run preview')}
    Preview the production build locally.

Get started now by running:

  cd ${answers.projectName}
  npm run dev

`)
  })
}


const ARGV = minimist(process.argv.slice(2))
const schemaPath = ARGV._[0]
run(schemaPath)
