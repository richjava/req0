import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito groups map to matrix roles: Admin, Manager, Viewer.
 * custom:department holds the manager's cost centre (Finance | Operations).
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ["Admin", "Manager", "Viewer"],
  userAttributes: {
    "custom:department": {
      dataType: "String",
      mutable: true,
      maxLen: 64,
      minLen: 1,
    },
  },
});
