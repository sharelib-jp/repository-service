// Package connectors contains portable example source definitions and mappings.
package connectors

import "embed"

//go:embed *.yaml
var Files embed.FS
