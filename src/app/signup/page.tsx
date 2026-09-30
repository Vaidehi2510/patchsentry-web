import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Create your workspace" };
export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
