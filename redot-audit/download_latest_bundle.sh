#!/usr/bin/env bash
# Use the latest successful, unexpired bundle instead of a fixed run ID.
set -euo pipefail
if [ "$#" -ne 3 ]; then echo 'usage: download_latest_bundle.sh <workflow-name> <artifact-name> <directory>' >&2; exit 2; fi
workflow=$1 artifact=$2 directory=$3
stage=$(mktemp -d); trap 'rm -rf "$stage"' EXIT
runs=$stage/runs.json
gh run list --repo "$GITHUB_REPOSITORY" --branch "$GITHUB_REF_NAME" --limit 100 --json databaseId,workflowName,status,conclusion > "$runs"
while read -r id; do
  count=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id/artifacts" --jq "[.artifacts[] | select(.name == \"$artifact\" and .expired == false)] | length")
  if [ "$count" = 1 ]; then
    rm -rf "$stage/artifact"
    if gh run download "$id" --repo "$GITHUB_REPOSITORY" --name "$artifact" --dir "$stage/artifact"; then
      mkdir "$directory"
      cp -a "$stage/artifact/." "$directory/"
      echo "Using $artifact from successful run $id"
      exit 0
    fi
  fi
done < <(jq -r --arg name "$workflow" '.[] | select(.workflowName == $name and .status == "completed" and .conclusion == "success") | .databaseId' "$runs")
echo "::error::No unexpired $artifact found; run $workflow first." >&2
exit 1
