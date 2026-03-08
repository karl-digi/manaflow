#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGES_FILE="${SCRIPT_DIR}/packages.yaml"

get_packages() {
    if command -v yq &> /dev/null; then
        yq -r '.packages[] | "\(.name)|\(.source)|\(.tokens)|\(.output)"' "$PACKAGES_FILE"
    else
        awk '
            /^  - name:/ { name = $3 }
            /source:/ { source = $2 }
            /tokens:/ { tokens = $2 }
            /output:/ { output = $2; print name "|" source "|" tokens "|" output }
        ' "$PACKAGES_FILE"
    fi
}

echo "Fetching documentation packages..."

while IFS='|' read -r name source tokens output; do
    output_path="${SCRIPT_DIR}/${output}"
    mkdir -p "$(dirname "$output_path")"

    if [[ "$source" == *"?"* ]]; then
        url="${source}&tokens=${tokens}"
    else
        url="${source}?tokens=${tokens}"
    fi

    echo "  Fetching: $name"
    if curl -fsSL "$url" -o "$output_path"; then
        echo "    -> $output"
    else
        echo "    FAILED: $name"
    fi
done < <(get_packages)

echo "Done."
