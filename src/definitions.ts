export interface AppConfig {
	source: string
	dryRun: boolean
	rootOnly?: boolean
	indexer?: IndexerConfig | IndexerMap
}

export type IndexerMap = IndexDefinition[] | Record<string, IndexDefinition[]>

export interface IndexDefinition {
	index: string
	files: FilesDefinition[]
}

export interface FilesDefinition {
	export: FileExport
	file?: string
	dir?: string
}

export type FileExport = 'default' | 'group' | 'individual' | 'skip' | 'slug' | 'wildcard'
export type DefaultFileExport = 'default' | 'group' | 'slug'
export type WordCase = 'camel' | 'kebab' | 'keep' | 'lower' | 'pascal' | 'snake' | 'upper'

export interface CommonIndexConfig {
	source: string[] | string
	casing?: WordCase
	include?: string[]
	ignore?: string[]
	typescript?: boolean
}

export interface IndexConfig extends CommonIndexConfig {
	output: string
	type: FileExport
	default?: DefaultIndexConfig
	overrides?: Record<string, FileExport>
}

export interface DefaultIndexConfig extends Omit<CommonIndexConfig, 'source'> {
	source?: string[] | string
	type: DefaultFileExport
	overrides?: Record<string, DefaultFileExport>
}

export interface IndexerConfig extends IndexConfig {
	recursive?: boolean
	indexes?: IndexerConfig[]
}

export interface IndexerResults {
	message: string
	type: 'error' | 'success' | 'warn'
}

export type IndexerResult = IndexDefinition[] | IndexerConfig | null
