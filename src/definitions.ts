export interface Config {
	source: string
	dryRun: boolean
	rootOnly?: boolean
	map?: IndexerMap | IndexerConfig
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
	type?: 'auto' | 'manual' | 'default' | 'group' | 'slug' | 'individual' | 'wildcard' | 'skip'
	include?: string[]
	ignore?: string[]
	typescript?: boolean
	indexes?: IndexerConfig[]
	recursive?: boolean
}

export interface IndexerResults {
	message: string
	type: 'success' | 'error' | 'warn'
}

export type IndexerResult = IndexDefinition[] | IndexerConfig | null
