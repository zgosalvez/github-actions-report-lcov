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
- `artifact-name`: The GitHub artifact name of the generated HTML report. For example, `code-coverage-report`. _Note:_ When downloading, it will be extracted in an `html` directory. Optional. Default: `` (Skips uploading of artifacts)
- `minimum-coverage`: The minimum coverage to pass the check. Optional. Default: `0` (always passes)
- `github-token`: Set the `${{ secrets.GITHUB_TOKEN }}` token to have the action comment the coverage summary in the pull request. This token is provided by Actions (after setting permissions - see sample workflow below), you do not need to create your own token. Optional. Default: ``
- `working-directory`: The working directory containing the source files referenced in the LCOV files. Optional. Default: `./`
- `title-prefix`: A prefix before the title "LCOV of commit...". Optional. Default: ``
- `additional-message`: Custom text appended to the code coverage comment in the pull request. Optional. Default: ``
- `update-comment`: Set to `true` to update the previous code coverage comment if such exists. When set to `false`, a new comment is always created. Optional. Default: `false`

### Outputs
- `total-coverage`: The total coverage from scanned files.

Sample comment:
![Screenshot](assets/comment.png)

### Common workflow

```yaml
on: pull_request

name: Continuous Integration

jobs:
  coverage_report:
    name: Generate coverage report
    needs: testing
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
    - name: Checkout code
      uses: actions/checkout@v2
    # ... Generate LCOV files or download it from a different job
    - name: Setup LCOV
      uses: hrishikesh-kadam/setup-lcov@v1
    - name: Report code coverage
      uses: zgosalvez/github-actions-report-lcov@v4
      with:
        coverage-files: coverage/lcov.*.info
        minimum-coverage: 90
        artifact-name: code-coverage-report
        github-token: ${{ secrets.GITHUB_TOKEN }}
        working-directory: apps/my-first-app
        update-comment: true
```
*Note:* Only the `pull_request` and `pull_request_target` events are supported. This action does nothing when triggered by other event types.

### Flutter Workflows

This is used in my opinionated [GitHub Actions: Flutter Workflows](https://github.com/zgosalvez/github-actions-flutter-workflows) repository along with other actions for a complete end-to-end DevOps experience.

## License
The scripts and documentation in this project are released under the [MIT License](LICENSE.md)
