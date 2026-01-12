// Re-export the OpenAPI-generated query options for branches.
// These are used in places that don't need infinite loading.
export {
  getApiIntegrationsGithubDefaultBranchOptions,
  getApiIntegrationsGithubBranchesOptions,
} from "@cmux/www-openapi-client/react-query";
