import { redirect } from "next/navigation";

export function generateMetadata() {
  return {
    title: "Miaowu OS",
  };
}

export default function Page() {
  redirect("/");
}
