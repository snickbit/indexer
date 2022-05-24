import {ask, confirm, fileExists, progress, saveFile} from '@snickbit/node-utilities'
import {arrayUnique} from '@snickbit/utilities'
import mkdirp from 'mkdirp'
import path from 'path'
import {$out, getExportName, getFirstLine, indexer_banner, makeExport, notAnIndexPredicate, posix} from './helpers'
import {AppConfig, FileExport, FilesDefinition, IndexDefinition, IndexerConfig, IndexerResult, IndexerResults} from './definitions'
import fg from 'fast-glob'

export default async function (config: AppConfig): Promise<IndexerResult> {
	let indexes_map: IndexDefinition[]
	let indexer_config: IndexerConfig
	const removeSource = string => string.replace(new RegExp(`^.*?/?${config.source}/?`), '')
	let indexes_changed: boolean

	$out.force.warn('Your configuration is setup to use the manual scan method. This method is deprecated and will be removed in a future release.')

	$out.verbose(config)

	indexes_map = config.indexer && Array.isArray(config.indexer) ? config.indexer : []
	$out.verbose(indexes_map)
	const old_indexes_map: IndexDefinition[] = indexes_map.slice()

	if (!Array.isArray(indexes_map)) {
		indexes_map = []
	}

	const file_glob = `${config.source}/**/*`
	const opts: { ignore?: string[], onlyFiles: boolean } = {onlyFiles: false}
	if (config.source) {
		opts.ignore = [config.source]
	}
	const paths = (await fg(file_glob, opts)).sort().filter(notAnIndexPredicate)
	const typescript = paths.find(file => file.endsWith('.ts'))
	const $progress = progress({message: `Scanning ${paths.length} paths`, total: paths.length})

	let last_directory = null
	let apply_to_directory = null
	const skipped_indexes = []

	for (let fp of paths) {
		if (!notAnIndexPredicate(fp) || !fileExists(fp) || (await getFirstLine(fp) === indexer_banner)) {
			continue
		}

		$out.warn(`Processing path: ${fp}`)

		let fd = posix.dirname(fp)
		let indexes: string[] = []

		for (let indexItem of indexes_map) {
			for (let fileItem of indexItem.files) {
				if (fileItem.file === fp || (fileItem.dir && fp.startsWith(fileItem.dir))) {
					indexes.push(indexItem.index)
				}
			}
		}

		if (last_directory !== fd) {
			apply_to_directory = null
			last_directory = fd
		}

		if (apply_to_directory) {
			$out.warn('Using inherited map for ' + fp)
			$progress.tick()
			continue
		}

		// get possible indexes for file
		const index_options: string[] = []
		let path_parts = config.source.split('/').slice(0, -1)
		const slice_count = fp.endsWith('/') ? -2 : -1
		const index_ext = !typescript || path.extname(fp).slice(1) === 'js' ? 'js' : 'ts'
		let path_pieces = fp.split('/').slice(0, slice_count).filter(p => !path_parts.includes(p))
		for (let p of path_pieces) {
			path_parts.push(p)
			const index_path = posix.join(...path_parts, 'index.' + index_ext)
			if (!indexes.includes(index_path) && !skipped_indexes.includes(index_path)) {
				// this file has not been configured for this index
				$out.debug(`Index "${index_path}" not configured for "${fp}"`)
				index_options.push(index_path)
			} else if (indexes.includes(index_path)) {
				$out.verbose(`Index "${index_path}" configured for "${fp}"`)
			} else {
				$out.debug(`Index "${index_path}" skipped`)
			}
		}

		if (index_options.length) {
			// this file has not been configured for these indexes

			$progress.stop()
			let selected_indexes: string[] = []
			if (index_options.length === 1) {
				selected_indexes = index_options
			} else {
				selected_indexes = await ask(`Select the indexes that will include ${fp}:`, {
					type: 'multiselect',
					choices: index_options
				})
			}
			$progress.start()

			// sort index options so that the selected indexes are first
			const sorted_index_options: string[] = arrayUnique(selected_indexes.concat(index_options)).sort(a => selected_indexes.includes(a) ? -1 : 1)

			let fp_indexes_map = []
			for (let index_option of sorted_index_options) {
				const merged_map: IndexDefinition[] = arrayUnique(fp_indexes_map.concat(indexes_map), 'index')
				const stored_index: number = merged_map.findIndex(i => i.index === index_option)
				const index: IndexDefinition = stored_index > -1 ? merged_map.splice(stored_index, 1).pop() : {index: index_option, files: []}
				index.files = index.files || []

				let export_type: FileExport | 'skip-index' = 'skip'

				$progress.stop()
				if (selected_indexes.includes(index_option)) {
					const {
						basename,
						slug,
						export_name
					} = getExportName(removeSource(fp))

					const choices = [
						{
							title: `Default export "export {default as ${export_name}}"`,
							value: 'default'
						},
						{
							title: `Grouped export "export * as ${export_name}"`,
							value: 'group'
						},
						{
							title: `Grouped slug export "export * as ${slug}"`,
							value: 'slug'
						},
						{
							title: 'All exports individually "export *"',
							value: 'wildcard'
						},
						{
							title: 'Don\'t include in index',
							value: 'skip'
						}
					]

					if (!indexes_map.find((def: IndexDefinition) => def.index === index_option)) {
						choices.push({
							title: 'Skip index',
							value: 'skip-index'
						})
					}

					export_type = await ask(`What should be exported from "${basename}" in index "${index_option}"`, {
						type: 'select',
						choices
					})

					if (export_type === 'skip-index') {
						skipped_indexes.push(index_option)
						continue
					}
				}

				apply_to_directory = apply_to_directory === null ? await confirm(`Apply these settings to all files in ${fd}?`) : apply_to_directory

				$progress.start()

				const conf: FilesDefinition = {
					export: export_type
				}

				if (apply_to_directory) {
					conf.dir = fd
				} else {
					conf.file = fp
				}

				index.files.push(conf)

				fp_indexes_map.push(index)
			}

			indexes_map = arrayUnique(fp_indexes_map.concat(indexes_map), 'index')
		}

		$progress.tick()
	}
	$progress.finish('Scan complete')

	indexes_changed = JSON.stringify(old_indexes_map) !== JSON.stringify(indexes_map)


	const filtered_index_map: IndexDefinition[] = indexes_map.filter(im => im.index.startsWith(config.source))

	$progress.start({message: 'Building indexes', total: filtered_index_map.length})
	$out.debug('Index files: ' + filtered_index_map.length)

	const results: IndexerResults[] = []
	for (let index_map of filtered_index_map) {
		let content: string[] = []
		let skipped_exports: string[] = []

		const skips: FilesDefinition[] = index_map.files.filter(p => p.export === 'skip')
		const notExcluded = p => notAnIndexPredicate(p) && !skips.find(s => s.file === p || p.startsWith(s.dir))

		for (let index_file of index_map.files) {
			const paths = []
			if (index_file.dir) {
				const files = await fg(`${index_file.dir}/*`, {onlyFiles: false, ignore: index_map.files.filter(f => f.file !== index_file.file).map(f => f.file)})
				paths.push(...files.filter(notExcluded).sort())
				$out.debug(`Found ${paths.length} paths for index dir ${index_file.dir}`)
			} else if (index_file.file) {
				paths.push(index_file.file)
				$out.debug(`Found ${paths.length} paths for index file ${index_file.file}`)
			} else {
				$out.error('Missing index file or directory')
				continue
			}

			$out.verbose({index_file, paths})

			for (let fp of paths) {
				if (!notAnIndexPredicate(fp)) {
					$progress.tick()
					continue
				}

				let export_type = index_file.export
				let file_path = posix.relative(posix.dirname(index_map.index), fp)
				if (!file_path.startsWith('.')) {
					file_path = `./${file_path}`
				}
				file_path = file_path.replace(/\.[jt]s$/, '')

				const noSource = removeSource(fp)

				if (export_type === 'skip') {
					if (!skipped_exports.includes(file_path)) {
						skipped_exports.push(file_path)
						$out.verbose('Skipping index for path: ' + file_path)
					}
				} else {
					$out.verbose(`Adding ${export_type} export to ${file_path}`)
					content.push(makeExport(export_type, file_path, noSource))
				}
			}
		}

		if (content.length > 0) {
			if (!config.dryRun) {
				mkdirp.sync(path.dirname(index_map.index))
				saveFile(index_map.index, indexer_banner + '\n\n' + content.join('\n') + '\n')
			}
			results.push({
				type: 'success',
				message: `${content.length} exports written to ${index_map.index}`
			})
		} else if ($out.isVerbose(1)) {
			results.push({
				type: 'warn',
				message: `No exports to write for index: ${index_map.index}`
			})
		}

		$progress.tick()
	}
	$progress.finish('Build complete')

	if (results.length) {
		if (config.dryRun) {
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

	if (indexer_config) {
		return indexer_config
	} else if (indexes_changed) {
		return indexes_map
	} else {
		return null
	}
}
