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

export interface IndexerConfig {
	source?: string[] | string
	output?: string
	type?: 'default' | 'group' | 'individual' | 'skip' | 'slug' | 'wildcard'
	casing?: 'camel' | 'kebab' | 'keep' | 'lower' | 'pascal' | 'snake' | 'upper'
	include?: string[]
	ignore?: string[]
	typescript?: boolean
	indexes?: IndexerConfig[]
	recursive?: boolean
	overrides?: Record<string, FileExport>
}

export interface IndexerResults {
	message: string
	type: 'error' | 'success' | 'warn'
}

export type IndexerResult = IndexDefinition[] | IndexerConfig | null
