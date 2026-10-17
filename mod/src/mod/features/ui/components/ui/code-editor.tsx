import { Editor } from "@monaco-editor/react";

export function CodeEditor(props: any) {

  return (
    <Editor
      height="400px"
      theme="vs-dark"
      defaultLanguage="text"
      defaultValue="{}"
      options={{
        wordWrap: "on",
        stickyScroll: {
          enabled: false,
        },
        minimap: {
          enabled: false,
        },
        scrollbar: {
          useShadows: false,
        },
      }}
      className="border-border overflow-hidden rounded-sm"
      {...props}
    />
  );
}

export default CodeEditor;
