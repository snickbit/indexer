#!/usr/bin/env node
import cli from '@snickbit/node-cli'
import {ask, confirm, fileExists, getFileJson, saveFileJson} from '@snickbit/node-utilities'
import {lilconfig} from 'lilconfig'
import packageJson from '../package.json'
import generate from './generate'
import {DEFAULT_CONFIG_NAME, out} from './helpers'

cli()
	.name('@snickbit/indexer')
	.version(packageJson.version)
	.banner('Generating Indexes')
	.includeWorkingPackage()
	.args({
		source: {
			description: 'The source directory to index',
			required: true
		}
	})
	.options({
		single: {
			alias: 's',
			describe: 'Only create index in root directory'
		},
		config: {
			alias: 'c',
			describe: 'Path to config file',
			type: 'string',
			default: DEFAULT_CONFIG_NAME
		},
		dryRun: {
			alias: ['d', 'dry'],
			describe: 'Dry run, do not write to disk'
		}
	})
	.run().then(async argv => {
	let config = {
		source: argv.source,
		dryRun: argv.dryRun
	}

	if (argv.config && argv.config !== 'false' && fileExists(argv.config)) {
		config.map = getFileJson(argv.config)
	} else {
		const result = await lilconfig('indexer').search()
		if (result) {
			config.map = result.config
		}
	}

	const updated_index_map = await generate(config)

	if (updated_index_map && !config.dryRun && await confirm('Do you want to save the updated configuration?')) {
		const save_path = await ask('Path to save config file?', DEFAULT_CONFIG_NAME)
		if (!save_path) {
			out.fatal('No path provided')
		}

		if (fileExists(save_path) && !await confirm(`File ${save_path} already exists. Overwrite?`)) {
			out.fatal('Aborted')
		}

		await saveFileJson(save_path, updated_index_map)
	}

	out.done('Done')
})
