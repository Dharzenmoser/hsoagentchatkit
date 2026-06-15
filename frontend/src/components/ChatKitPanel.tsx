import { useMemo } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId } from "../lib/chatkitSession";

export function ChatKitPanel() {
  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId),
    []
  );

  const chatkit = useChatKit({
    api: {
      getClientSecret
    },
    composer: {
      attachments: {
        enabled: true,
        accept: {
          "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
          "application/pdf": [".pdf"],
          "text/plain": [".txt"],
          "text/markdown": [".md"],
          "application/msword": [".doc"],
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
            ".docx",
          ],
        },
        maxCount: 5,
        maxSize: 20 * 1024 * 1024, // 20 MB
      },
    },
  });

  return (
    <div className="flex h-[90vh] w-full rounded-2xl bg-white shadow-sm transition-colors dark:bg-slate-900">
      <ChatKit control={chatkit.control} className="h-full w-full" />
    </div>
  );
}
