# The Fastlane lane shape

Read before writing or changing a Fastfile: one release lane per platform, secrets from the runner's ENV, a pre-production track first.

```ruby
# fastlane/Fastfile - secrets arrive via ENV from the CI runner, never from the repo
platform :ios do
  lane :release do
    app_store_connect_api_key(key_id: ENV['ASC_KEY_ID'],
      issuer_id: ENV['ASC_ISSUER_ID'], key_content: ENV['ASC_KEY_P8'])
    match(type: 'appstore', readonly: true)
    build_app(workspace: 'ios/App/App.xcworkspace', scheme: 'App')
    pilot   # -> TestFlight, not production
  end
end

platform :android do
  lane :release do
    gradle(task: 'bundle', build_type: 'Release')
    supply(track: 'internal')   # -> Play internal track first
  end
end
```
