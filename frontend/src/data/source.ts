import { createContext, useContext } from 'react'
import { dataSourceMode, type DataSource } from './DataSource'
import { LiveApi } from './liveApi'
import { StaticBundle } from './staticBundle'

export const defaultDataSource: DataSource = dataSourceMode === 'static' ? new StaticBundle() : new LiveApi()

export const DataSourceContext = createContext<DataSource>(defaultDataSource)

export const useDataSource = () => useContext(DataSourceContext)
