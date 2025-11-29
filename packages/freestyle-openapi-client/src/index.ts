import {
  createClient as createGeneratedClient,
  type Client,
  type ClientOptions,
  type Config,
} from './client/client/index.js';

export * from './client/index.js';

export const DEFAULT_FREESTYLE_BASE_URL = 'https://api.freestyle.sh';

export type FreestyleClient = Client;
export type FreestyleClientConfig = Config<ClientOptions>;

export const createFreestyleClient = (
  config: FreestyleClientConfig = {}
): FreestyleClient =>
  createGeneratedClient({
    ...config,
    baseUrl: config.baseUrl ?? DEFAULT_FREESTYLE_BASE_URL,
  });
