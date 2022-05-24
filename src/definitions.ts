export interface AppConfig {
	source: string
	dryRun: boolean
	rootOnly?: boolean
	indexer?: IndexerMap | IndexerConfig
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

export type FileExport = 'default' | 'group' | 'slug' | 'individual' | 'wildcard' | 'skip'

export interface IndexerConfig {
	source?: string | string[]
	output?: string
	type?: 'default' | 'group' | 'slug' | 'individual' | 'wildcard' | 'skip'
	include?: string[]
	ignore?: string[]
	typescript?: boolean
	indexes?: IndexerConfig[]
	recursive?: boolean
	overrides?: Record<string, FileExport>
}

export interface IndexerResults {
	message: string
	type: 'success' | 'error' | 'warn'
}

export type IndexerResult = IndexDefinition[] | IndexerConfig | null
