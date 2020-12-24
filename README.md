# GitHub Action — Report LCOV

This GitHub Action (written in JavaScript) allows you to leverage GitHub Actions to report the code coverage from LCOV files. This action includes:
- Generating an HTML report as an artifact
- Commenting on a pull request (if the workflow was triggered by this event)
- Failing if a minimum coverage is not met

## Usage
### Pre-requisites
Create a workflow `.yml` file in your `.github/workflows` directory. An [example workflow](#common-workflow) is available below. For more information, reference the GitHub Help Documentation for [Creating a workflow file](https://help.github.com/en/articles/configuring-a-workflow#creating-a-workflow-file).

### Inputs
For more information on these inputs, see the [Workflow syntax for GitHub Actions](https://docs.github.com/actions/reference/workflow-syntax-for-github-actions#jobsjob_idstepswith)

- `coverage-files`: The coverage files to scan. For example, `coverage/lcov.*.info`
- `artifact-name`: The GitHub artifact name of the generated HTML report. For example, `code-coverage-report`. _Note:_ When downloading, it will be extracted in an `html` directory
- `minimum-coverage`: The minimum coverage to pass the check. Optional. Default: `0` (always passes)
- `github-token`: Set the `${{ secrets.GITHUB_TOKEN }}` token to have the action comment the coverage summary in the pull request. This token is provided by Actions, you do not need to create your own token. Optional. Default: ``

### Outputs
None.

### Common workflow

Ideally, set this up as an initial job for your workflows. For example:
```yaml
on: push

name: Continuous Integration

jobs:
  harden_security:
    name: Harden Security
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@5a4ac9002d0be2fb38bd78e4b4dbde5606d7042f # v2.3.4
      - name: Ensure SHA pinned actions
        uses: zgosalvez/github-actions-ensure-sha-pinned-actions@v1.0.1 # Replace this
```

### Flutter Workflows

This is used in my opinionated [GitHub Actions: Flutter Workflows](https://github.com/zgosalvez/github-actions-flutter-workflows) repository along with other actions for a complete end-to-end DevOps experience.

## License
The scripts and documentation in this project are released under the [MIT License](LICENSE)