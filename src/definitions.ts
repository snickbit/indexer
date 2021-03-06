export interface AppConfig {
	source: string
	output?: string
	dryRun: boolean
	rootOnly?: boolean
	indexer?: IndexerConfig
}

export type FileExport = 'default' | 'group' | 'individual' | 'skip' | 'slug' | 'wildcard'
export type DefaultFileExport = 'default' | 'group' | 'slug'
export type WordCase = 'camel' | 'keep' | 'lower' | 'pascal' | 'snake' | 'upper'

export interface CommonIndexConfig {
	source: string[] | string
	casing?: WordCase
	ignore?: string[]
	include?: string[]
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
