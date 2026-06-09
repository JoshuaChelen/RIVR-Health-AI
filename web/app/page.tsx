import { Logo } from "@/components/ui";

export default function Home() {
  return (
    <div className="grid min-h-screen place-items-center px-4 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">
        <Logo size={84} />
        <p className="text-sub">Your health records, organized.</p>
      </div>
    </div>
  );
}
