export const HOME_DIR = "/root";

export const OPENVSCODE_USER_DIR = `${HOME_DIR}/.openvscode-server/data/User`;
export const OPENVSCODE_PROFILE_DIR = `${OPENVSCODE_USER_DIR}/profiles/default-profile`;
export const OPENVSCODE_MACHINE_DIR = `${HOME_DIR}/.openvscode-server/data/Machine`;
export const OPENVSCODE_SNIPPETS_DIR = `${OPENVSCODE_USER_DIR}/snippets`;
export const OPENVSCODE_EXT_DIR = `${HOME_DIR}/.openvscode-server/extensions`;

export const CMUX_INTERNAL_DIR = `${HOME_DIR}/.cmux`;
export const EXTENSION_LIST_PATH = `${CMUX_INTERNAL_DIR}/user-extensions.txt`;
export const EXTENSION_INSTALL_SCRIPT_PATH = `${CMUX_INTERNAL_DIR}/install-extensions-background.sh`;
export const EXTENSION_PROFILE_HOOK_PATH = "/etc/profile.d/cmux-extensions.sh";
