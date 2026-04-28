"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { PublishIdeaModal } from "./publish-idea-modal";

export function PublishIdeaButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className ?? "btn-primary"} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Publish Idea
      </button>
      <PublishIdeaModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
