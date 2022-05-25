import {ask, confirm, fileExists, mkdir, saveFile} from '@snickbit/node-utilities'
import path from 'path'
import {$out, getFirstLine, indexer_banner, posix} from './helpers'
import {AppConfig, IndexerConfig, IndexerResult, IndexerResults} from './definitions'
import fg from 'fast-glob'
import {camelCase, isArray, JSONPrettify, kebabCase, objectExcept, objectFindKey, safeVarName, slugify, snakeCase} from '@snickbit/utilities'
import picomatch from 'picomatch'

export default async function (config: AppConfig): Promise<IndexerResult> {
	const conf = config.indexer as IndexerConfig
	if (conf.indexes) {
		const root: Omit<IndexerConfig, 'indexes'> = objectExcept(conf, ['indexes'])
		for (let key in conf.indexes) {
			conf.indexes[key] = await generateIndexes(config, {...root, ...conf.indexes[key]}) as IndexerConfig
		}
		config.indexer = conf
	} else {
		config.indexer = await generateIndexes(config)
	}

	return config.indexer
}

let _outputs: string[]

function getOutputs(indexerConfig: IndexerConfig) {
	if (!_outputs) {
		const indexes = indexerConfig.indexes || [indexerConfig]

		_outputs = indexes.map(index => index.output)
	}
	return _outputs
}

async function generateIndexes(appConfig: AppConfig, config?: IndexerConfig): Promise<IndexerResult> {
	let indexer_config: IndexerConfig
	let conf = (config || appConfig.indexer || {}) as IndexerConfig
	getOutputs(appConfig)

	if (!conf) {
		conf = {
			source: await ask('Source glob pattern:', {initial: 'src/**/*.ts'}),
			output: await ask('Output file:', {initial: 'src/index.ts'}),
			type: await ask('Export type:', {
				type: 'select',
				choices: [
					{
						title: `Automatic"`,
						value: 'auto'
					},
					{
						title: `Wildcard export "export * from './path/to/filename'"`,
						value: 'wildcard'
					},
					{
						title: `Default export "export {default as filename} from './path/to/filename'",`,
						value: 'default'
					},
					{
						title: `Group export "export * as filename from './path/to/filename'"`,
						value: 'group'
					},
					{
						title: `Slug export "export * as path_to_filename from './path/to/filename'"`,
						value: 'slug'
					}
				]
			}),
			typescript: await confirm('Use typescript?', true)
		} as IndexerConfig

		indexer_config = conf
	}

	if (!conf.source) {
		$out.fatal('Source glob pattern is required')
	}
	if (!conf.output) {
		$out.fatal('Output file is required')
	}
	if (!conf.type) {
		conf.type = 'wildcard'
	}

	const ignore = [conf.output]

	if (conf.ignore) {
		ignore.push(...conf.ignore)
	}

	const content: string[] = []
	const results: IndexerResults[] = []

	const source = posix.dirname(conf.output)
	const indexes: Record<string, string[]> = {
		[source]: []
	}

	const files = await fg(conf.source, {ignore, onlyFiles: !conf.recursive})
	if (!files.length) {
		results.push({
			type: 'warn',
			message: 'No files found matching source\n' + JSONPrettify(conf.source)
		})
	}

	for (let file of files) {
		if (await shouldIgnore(conf, file)) {
			continue
		}

		if (conf.recursive) {
			const dirname = posix.dirname(file)
			if (!indexes[dirname]) {
				indexes[dirname] = []
			}

			indexes[dirname].push(file.replace(/\.[jt]s$/, ''))
		} else {
			content.push(makeExport(conf, source, file))
		}
	}

	if (conf.recursive) {
		indexes[source].push(...(await fg(source + '/*', {onlyDirectories: true}) || []))

		// loop indexes and write each index
		const ext = path.extname(conf.output)
		for (let [dir, files] of Object.entries(indexes)) {
			const indexFile = posix.join(dir, 'index' + ext)
			let indexContent: string[] = []
			for (let file of files) {
				indexContent.push(makeExport(conf, indexFile, file))
			}

			if (indexContent.length > 0) {
				if (!appConfig.dryRun) {
					mkdir(path.dirname(indexFile), {recursive: true})
					saveFile(indexFile, indexer_banner + '\n\n' + indexContent.sort().join('\n') + '\n')
				}
				results.push({
					type: 'success',
					message: `${indexContent.length} exports written to ${indexFile}`
				})
			} else if ($out.isVerbose(1)) {
				results.push({
					type: 'warn',
					message: `No exports to write for index: ${indexFile}`
				})
			}
		}
	}

	if (content.length > 0) {
		if (!appConfig.dryRun) {
			mkdir(path.dirname(conf.output), {recursive: true})
			saveFile(conf.output, indexer_banner + '\n\n' + content.sort().join('\n') + '\n')
		}
		results.push({
			type: 'success',
			message: `${content.length} exports written to ${conf.output}`
		})
	} else if ($out.isVerbose(1)) {
		results.push({
			type: 'warn',
			message: `No exports to write for index: ${conf.output}`
		})
	}

	if (results.length) {
		if (appConfig.dryRun) {
			$out.info('DRY RUN : No changes have been made to the filesystem')
		}
		for (let result of results) {
			if ($out[result.type]) {
				$out[result.type](result.message)
			} else {
				$out.info(result.message)
			}
		}
	}

	return indexer_config
}


function makeExport(conf: IndexerConfig, source: string, file: string) {
	const override = conf.overrides && objectFindKey(conf.overrides, (key) => picomatch(key)(file))
	const export_type = override ? conf.overrides[override] : conf.type

	const resolvedIndex = posix.resolve(source)
	const resolvedFile = posix.resolve(file)
	let file_path = posix.relative(resolvedIndex, resolvedFile).replace(/^\.\./, '.').replace(/\.[jt]s$/, '').replace(/\/index$/, '')
	if (file_path === '.') file_path = './index'

	const dirname = path.dirname(file)
	const filename = path.basename(file, path.extname(file))

	if (export_type === 'slug') {
		const slug = safeVarName(slugify(path.join(dirname, filename)))
		return `export * as ${slug} from '${file_path}'`
	} else {
		let export_name = makeExportName(filename, conf.casing)

		switch (export_type) {
			case 'group':
				return `export * as ${export_name} from '${file_path}'`
			case 'individual':
			case 'wildcard':
				return `export * from '${file_path}'`
			default:
				return `export {default as ${export_name}} from '${file_path}'`
		}
	}
}

function makeExportName(name: string, casing: IndexerConfig['casing'] = 'keep'): string {
	switch (casing) {
		case 'camel':
			return camelCase(name)
		case 'pascal':
			return name.charAt(0).toUpperCase() + camelCase(name.slice(1))
		case 'kebab':
			return kebabCase(name)
		case 'snake':
			return snakeCase(name)
		case 'upper':
			return name.toUpperCase()
		case 'lower':
			return name.toLowerCase()
		default: // case keep
			return safeVarName(name).replace(/_/g, '')
	}
}

async function shouldIgnore(conf: IndexerConfig, file: string): Promise<boolean> {
	if (file === conf.output) return true
	if (!fileExists(file)) return true
	if (isArray(conf.ignore) && conf.ignore.some(ignore => ignore && picomatch(ignore)(file))) return true

	if (getOutputs(conf).some(ignore => ignore && picomatch(ignore)(file)) || file.match(/\/index\.[a-z]+$/)) {
		return await getFirstLine(file) === indexer_banner
	}

	return false
}
