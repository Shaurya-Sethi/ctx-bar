# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `Shaurya-Sethi/ctx-bar`.
Use the `gh` CLI from this clone; prefix shell commands with `rtk`.

## Ticket operations

- Publish: `rtk gh issue create --title "..." --body "..."`
- Fetch: `rtk gh issue view <number> --comments`
- List: `rtk gh issue list --state open --json number,title,body,labels,comments`
- Comment: `rtk gh issue comment <number> --body "..."`
- Label: `rtk gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `rtk gh issue close <number> --comment "..."`

For multiline bodies, use a file with `--body-file`.
Apply label and state filters when listing.

## Pull requests as a triage surface

**PRs as a request surface: no.** Set to `yes` if external PRs should enter the triage queue.

## Linked work

Use native sub-issues and issue dependencies when supported.
Otherwise, put `Part of #<parent>` and `Blocked by: #<number>`
at the top of child issue bodies, and list children in the parent.

For wayfinding, label the map `wayfinder:map` and its children
`wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`,
or `wayfinder:task`. Select the first unassigned, unblocked open
child in map order. Claim it before working; comment and close
when resolved, then record the result and link in the map.
