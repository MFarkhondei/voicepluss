@@
-        const data = await res.json();
-        if (!res.ok) throw new Error(data?.error || "خطا در پردازش فایل صوتی");
-        if (!data.text) throw new Error("متنی تشخیص داده نشد. لطفاً دوباره ضبط کنید.");
-        setText(data.text);
-        setSegments(data.segments ?? []);
+        const data = await res.json();
+        if (!res.ok) throw new Error(data?.error || "خطا در پردازش فایل صوتی");
+        // fallback: if API didn't return a `text` field, build one from segments
+        const textFromSegments = (data.segments ?? []).map((s: any) => (s.text ?? "").trim()).join(" ").trim();
+        const finalText = (data.text?.trim() || textFromSegments) ?? "";
+        if (!finalText) throw new Error("متنی تشخیص داده نشد. لطفاً دوباره ضبط کنید.");
+        setText(finalText);
+        setSegments(data.segments ?? []);
@@
