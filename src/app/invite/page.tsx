import { Invitation } from "@/components/invitation";
export const metadata = {
  title: "Team invitation",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <Invitation />;
}
