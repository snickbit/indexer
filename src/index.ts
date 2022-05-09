#!/usr/bin/env node
import cli from '@snickbit/node-cli'
import {ask, confirm, fileExists, getFileJson, saveFileJson} from '@snickbit/node-utilities'
import {lilconfig} from 'lilconfig'
import packageJson from '../package.json'
import generate from './generate'
import {$out, DEFAULT_CONFIG_NAME} from './helpers'
import {Config} from './definitions'

cli()
.name('@snickbit/indexer')
.version(packageJson.version)
.banner('Generating Indexes')
.includeWorkingPackage()
.args({
	source: {
		description: 'The source directory to index'
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
	let config: Config = {
		source: argv.source,
		dryRun: argv.dryRun
	}

	let configPath

	if (argv.config && argv.config !== 'false' && fileExists(argv.config)) {
		configPath = argv.config
		config.map = getFileJson(argv.config)
	} else {
		const result = await lilconfig('indexer').search()
		if (result) {
			configPath = result.filepath
			config.map = result.config
		}
	}

	let update_config = false

	if (config.map || config.source) {
		// validate config
		if (config.source || Array.isArray(config.map)) {
			config.map = await generate(config)
			if (config.map) update_config = true
		} else if (typeof config.map === 'object' && !Array.isArray(config.map)) {
			for (const [source, map] of Object.entries(config.map)) {
				const conf: Config = {
					source,
					map,
					dryRun: config.dryRun
				}
				const result = await generate(conf)

				if (result) {
					config.map[source] = result
					update_config = true
				}
			}
		} else {
			$out.fatal('Invalid config file')
		}
	} else {
		$out.fatal('No configuration found')
	}

	if (update_config && !config.dryRun && await confirm('Do you want to save the updated configuration?')) {
		const save_path = configPath || await ask('Path to save config file?', DEFAULT_CONFIG_NAME)
		if (!save_path) {
			$out.fatal('No path provided')
		}
		await saveFileJson(save_path, config.map)
	}

	$out.done('Done')
})
