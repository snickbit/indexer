import {ask, confirm, fileExists, progress, saveFile} from '@snickbit/node-utilities'
import {arrayUnique} from '@snickbit/utilities'
import mkdirp from 'mkdirp'
import path from 'path'
import {$out, getExportName, getFirstLine, indexer_banner, makeExport, notAnIndexPredicate, posix} from './helpers'
import {Config, FileExport, FilesDefinition, IndexDefinition, IndexerConfig, IndexerResult, IndexerResults} from './definitions'
import fg from 'fast-glob'

export class Indexer {
	config: Config
	indexes_map: IndexDefinition[]
	indexer_config: IndexerConfig
	removeSource: (string) => string
	indexes_changed: boolean

	constructor(config: Config) {
		this.config = config
		this.makeRemoveSource(this.config.source)
	}

	private makeRemoveSource(source: string): void {
		this.removeSource = string => string.replace(new RegExp(`^.*?/?${source}/?`), '')
	}

	async manualScan(): Promise<IndexerResult> {
		$out.verbose(this.config)

		this.indexes_map = this.config.map && Array.isArray(this.config.map) ? this.config.map : []
		$out.verbose(this.indexes_map)
		const old_indexes_map: IndexDefinition[] = this.indexes_map.slice()

		if (!Array.isArray(this.indexes_map)) {
			this.indexes_map = []
		}

		const file_glob = `${this.config.source}/**/*`
		const opts: { ignore?: string[], onlyFiles: boolean } = {onlyFiles: false}
		if (this.config.source) {
			opts.ignore = [this.config.source]
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

			for (let indexItem of this.indexes_map) {
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
			let path_parts = this.config.source.split('/').slice(0, -1)
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
					const merged_map: IndexDefinition[] = arrayUnique(fp_indexes_map.concat(this.indexes_map), 'index')
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
						} = getExportName(this.removeSource(fp))

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

						if (!this.indexes_map.find((def: IndexDefinition) => def.index === index_option)) {
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

				this.indexes_map = arrayUnique(fp_indexes_map.concat(this.indexes_map), 'index')
			}

			$progress.tick()
		}
		$progress.finish('Scan complete')

		this.indexes_changed = JSON.stringify(old_indexes_map) !== JSON.stringify(this.indexes_map)
		return this.writeIndexes()
	}

	async writeIndexes(): Promise<IndexerResult> {
		const filtered_index_map: IndexDefinition[] = this.indexes_map.filter(im => im.index.startsWith(this.config.source))

		const $progress = progress({message: 'Building indexes', total: filtered_index_map.length})
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

					const noSource = this.removeSource(fp)

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
				if (!this.config.dryRun) {
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

		return this.results(results)
	}

	async autoScan(config?: IndexerConfig): Promise<IndexerResult> {
		let conf = (config || this.config.map || {}) as IndexerConfig

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

			this.indexer_config = conf
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
		for (let file of files) {
			if (conf.recursive) {
				if (!notAnIndexPredicate(file) || !fileExists(file) || (await getFirstLine(file) === indexer_banner)) {
					continue
				}
				const dirname = posix.dirname(file)
				if (!indexes[dirname]) {
					indexes[dirname] = []
				}

				indexes[dirname].push(file.replace(/\.[jt]s$/, ''))
			} else {
				content.push(makeExport(conf.type, './' + posix.relative(source, file), file))
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
					indexContent.push(makeExport(conf.type, posix.relative(posix.resolve(indexFile), posix.resolve(file)).replace(/^\.\./, '.'), file))
				}

				if (indexContent.length > 0) {
					if (!this.config.dryRun) {
						mkdirp.sync(path.dirname(conf.output))
						saveFile(indexFile, indexer_banner + '\n\n' + indexContent.join('\n') + '\n')
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
			if (!this.config.dryRun) {
				mkdirp.sync(path.dirname(conf.output))
				saveFile(conf.output, indexer_banner + '\n\n' + content.join('\n') + '\n')
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

		return this.results(results)
	}

	async results(results: IndexerResults[]): Promise<IndexerResult> {
		if (results.length) {
			if (this.config.dryRun) {
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

		if (this.indexer_config) {
			return this.indexer_config
		} else if (this.indexes_changed) {
			return this.indexes_map
		} else {
			return null
		}
	}
}
