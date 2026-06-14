// src/navigation/authTypes.ts
export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  UpdatePassword: { uid?: string; token?: string } | undefined;
};