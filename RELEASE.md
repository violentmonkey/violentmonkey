# Release

Create a tag and push, GitHub Actions will build the assets and upload them to different stores.

## Prerelease

```bash
$ git checkout master
$ yarn bump
$ git push origin master --follow-tags
```

## Release

Merge everything that is ready to release to the `release` branch and bump version.

```bash
$ git checkout release
$ git merge master # or git merge v2.13.2
$ yarn version --minor
$ git push origin release --follow-tags
```

Finally merge `release` back to `master`.

```bash
$ git checkout master
$ git merge release
```
