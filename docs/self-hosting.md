# Self-hosting Meally

## Configuration

Feature flags can be fixed with environment variables. The form is `MEALLY_FEATURE_<KEY>=on|off`, where `<KEY>` is
the flag key in upper case with `-` replaced by `_`:

```
MEALLY_FEATURE_MEAL_PLAN=off
MEALLY_FEATURE_AI=on
```

A flag set this way is locked: admins can't change it in the app. Flags that are not set can be changed by an admin.
A feature stays off if a feature it depends on is off. See `packages/shared/src/features.ts` for all keys.
