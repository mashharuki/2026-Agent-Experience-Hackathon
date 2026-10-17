import { createContext, useContext } from "react";

export interface AuthState {
  status: "loading" | "signed-out" | "signed-in" | "error";
  userLabel?: string;
  signIn: () => void;
  signOut: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("AuthProvider is missing");
  return auth;
}
