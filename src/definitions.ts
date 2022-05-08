export interface Config {
	source: string
	dryRun: boolean
	rootOnly?: boolean
	map?: IndexerMap
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

export type FileExport = 'default' | 'group' | 'slug' | 'individual' | 'skip'

export interface IndexerConfig {
	source: string
	output?: string
	recursive: boolean
	type?: 'auto' | 'manual' | 'default' | 'group' | 'slug' | 'individual' | 'skip'
	include?: string[]
	exclude?: string[]
	map?: IndexerMap
}

export interface IndexerResults {
	message: string
	type: 'success' | 'error' | 'warn'
}
