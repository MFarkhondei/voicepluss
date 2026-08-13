import { useState, useRef, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Upload,
  FileAudio,
  Play,
  Pause,
  Copy,
  Download,
  Settings,
  Languages,
  Wand2,
  ListMusic,
  FileText,
  Volume2,
  Trash2,
  Check,
  Plus,
  RefreshCw,
  Clock,
  Sparkles,
  Link as LinkIcon,
  Search,
  CheckSquare,
  Square,
  FolderPlus,
  Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChunkUploader } from "@/components/ChunkUploader";
import { Waveform } from "@/components/Waveform";
import { HealthBadgeLayout } from "@/components/HealthBadgeLayout";
import { toast } from "sonner";
import {
  getPlaylists,
  savePlaylists,
  getAudioFiles,
  saveAudioFiles,
  exportLibraryData,
  importLibraryData,
  type Playlist,
  type AudioFile,
} from "@/lib/library";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [activeTab, setActiveTab] = useState("upload");
  const [transcriptionText, setTranscriptionText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [refinedText, setRefinedText] = useState("");
  const [analysisText, setAnalysisText] = useState("");
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("all");
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);

  const [targetLanguage, setTargetLanguage] = useState("fa");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    setPlaylists(getPlaylists());
    const loadedFiles = getAudioFiles();
    setAudioFiles(loadedFiles);
    if (loadedFiles.length > 0 && !selectedFileId) {
      setSelectedFileId(loadedFiles[0].id);
    }
  }, []);

  const handleCreatePlaylist = () => {
    if (!newPlaylistName.trim()) return;
    const newPl: Playlist = {
      id: Date.now().toString(),
      name: newPlaylistName.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [...playlists, newPl];
    setPlaylists(updated);
    savePlaylists(updated);
    setNewPlaylistName("");
    toast.success("پلی‌لیست جدید ایجاد شد");
  };

  const handleFileUploadSuccess = (fileData: { name: string; url: string; size: number }) => {
    const newFile: AudioFile = {
      id: Date.now().toString(),
      name: fileData.name,
      url: fileData.url,
      size: fileData.size,
      duration: 0,
      createdAt: new Date().toISOString(),
      playlistId: selectedPlaylistId !== "all" ? selectedPlaylistId : undefined,
    };
    const updated = [newFile, ...audioFiles];
    setAudioFiles(updated);
    saveAudioFiles(updated);
    setSelectedFileId(newFile.id);
    toast.success("فایل با موفقیت اضافه شد");
  };

  const selectedFile = audioFiles.find((f) => f.id === selectedFileId);

  const filteredFiles = audioFiles.filter((file) => {
    const matchesPlaylist =
      selectedPlaylistId === "all" || file.playlistId === selectedPlaylistId;
    const matchesSearch = file.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesPlaylist && matchesSearch;
  });

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleTranscribe = async () => {
    if (!selectedFile) {
      toast.error("لطفاً ابتدا یک فایل صوتی انتخاب کنید");
      return;
    }
    setIsTranscribing(true);
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioUrl: selectedFile.url }),
      });
      const data = await res.json();
      if (data.text) {
        setTranscriptionText(data.text);
        toast.success("پیاده‌سازی با موفقیت انجام شد");
      } else {
        toast.error(data.error || "خطا در پیاده‌سازی");
      }
    } catch (err) {
      toast.error("ارتباط با سرور برقرار نشد");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleTranslate = async () => {
    if (!transcriptionText) {
      toast.error("متنی برای ترجمه وجود ندارد");
      return;
    }
    setIsTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcriptionText, targetLang: targetLanguage }),
      });
      const data = await res.json();
      if (data.translatedText) {
        setTranslatedText(data.translatedText);
        toast.success("ترجمه با موفقیت انجام شد");
      } else {
        toast.error("خطا در ترجمه متن");
      }
    } catch (err) {
      toast.error("خطا در سیستم ترجمه");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleRefine = async () => {
    if (!transcriptionText) {
      toast.error("متنی برای بازنویسی وجود ندارد");
      return;
    }
    setIsRefining(true);
    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcriptionText }),
      });
      const data = await res.json();
      if (data.refinedText) {
        setRefinedText(data.refinedText);
        toast.success("ویرایش و هوشمندسازی متن انجام شد");
      } else {
        toast.error("خطا در ویرایش متن");
      }
    } catch (err) {
      toast.error("خطا در ارتباط با هوش مصنوعی");
    } finally {
      setIsRefining(false);
    }
  };

  const handleAnalyze = async () => {
    if (!transcriptionText) {
      toast.error("متنی برای تحلیل وجود ندارد");
      return;
    }
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcriptionText }),
      });
      const data = await res.json();
      if (data.analysis) {
        setAnalysisText(data.analysis);
        toast.success("تحلیل متن با موفقیت تولید شد");
      } else {
        toast.error("خطا در تحلیل متن");
      }
    } catch (err) {
      toast.error("خطا در سیستم تحلیل");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <HealthBadgeLayout>
      <div className="container mx-auto p-4 md:p-6 space-y-6 dir-rtl" dir="rtl">
        {/* هدر اصلی */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-primary/10 via-primary/5 to-background p-6 rounded-2xl border border-primary/20 shadow-sm">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-primary flex items-center gap-2">
              <Sparkles className="h-7 w-7 text-primary animate-pulse" />
              سامانه هوشمند پیاده‌سازی و پردازش صوت
            </h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">
              تبدیل گفتار به متن، ترجمه خودکار، ویرایش هوشمند و مدیریت آرشیو صوتی
            </p>
          </div>
        </div>

        {/* چیدمان اصلی ۳ ستونی در دسکتاپ */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ================= ستون سمت راست: بارگذاری فایل (حجم ۴ ستون) ================= */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="border-2 border-emerald-500/30 dark:border-emerald-500/20 shadow-md hover:shadow-lg transition-all rounded-xl overflow-hidden">
              <CardHeader className="bg-emerald-500/10 dark:bg-emerald-500/5 pb-4 border-b border-emerald-500/20">
                <CardTitle className="text-lg font-bold flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <Upload className="h-5 w-5" />
                  بارگذاری صوت
                </CardTitle>
                <CardDescription>
                  انتخاب فایل صوتی یا وارد کردن لینک مستقیم جهت پردازش
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-6 space-y-6">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid grid-cols-2 w-full mb-4">
                    <TabsTrigger value="upload">فایل محلی</TabsTrigger>
                    <TabsTrigger value="link">لینک مستقیم</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="upload" className="space-y-4">
                    <ChunkUploader onUploadSuccess={handleFileUploadSuccess} />
                  </TabsContent>
                  
                  <TabsContent value="link" className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="audio-url">آدرس URL فایل صوتی</Label>
                      <div className="flex gap-2">
                        <Input
                          id="audio-url"
                          placeholder="https://example.com/audio.mp3"
                          className="dir-ltr text-left"
                        />
                        <Button className="shrink-0">
                          <LinkIcon className="h-4 w-4 ml-1" />
                          دریافت
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>

                <Separator />

                {/* ایجاد پلی‌لیست جدید */}
                <div className="space-y-3 bg-muted/40 p-3 rounded-lg border border-border/50">
                  <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <FolderPlus className="h-3.5 w-3.5" />
                    ایجاد پلی‌لیست جدید
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="نام پلی‌لیست..."
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      className="h-9 text-sm"
                    />
                    <Button size="sm" onClick={handleCreatePlaylist} className="shrink-0 h-9">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ================= ستون وسط: پلی‌لیست + پخش‌کننده صوت (حجم ۴ ستون) ================= */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="border-2 border-blue-500/30 dark:border-blue-500/20 shadow-md hover:shadow-lg transition-all rounded-xl overflow-hidden flex flex-col h-full min-h-[500px]">
              <CardHeader className="bg-blue-500/10 dark:bg-blue-500/5 pb-4 border-b border-blue-500/20">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg font-bold flex items-center gap-2 text-blue-700 dark:text-blue-400">
                    <ListMusic className="h-5 w-5" />
                    پلی‌لیست و آرشیو
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {filteredFiles.length} فایل
                  </Badge>
                </div>
                <CardDescription>
                  مدیریت و انتخاب فایل‌های صوتی بارگذاری شده
                </CardDescription>
              </CardHeader>
              
              <CardContent className="p-4 space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  {/* فیلتر پلی‌لیست و جستجو */}
                  <div className="flex gap-2">
                    <Select value={selectedPlaylistId} onValueChange={setSelectedPlaylistId}>
                      <SelectTrigger className="w-full text-xs h-9">
                        <SelectValue placeholder="همه پلی‌لیست‌ها" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">همه فایل‌ها</SelectItem>
                        {playlists.map((pl) => (
                          <SelectItem key={pl.id} value={pl.id}>
                            {pl.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="relative">
                    <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="جستجوی فایل..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pr-9 h-9 text-xs"
                    />
                  </div>

                  {/* لیست فایل‌ها */}
                  <ScrollArea className="h-[260px] rounded-md border p-2 bg-background/50">
                    {filteredFiles.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-xs">
                        فایلی یافت نشد
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {filteredFiles.map((file) => {
                          const isSelected = file.id === selectedFileId;
                          return (
                            <div
                              key={file.id}
                              onClick={() => setSelectedFileId(file.id)}
                              className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all border text-xs ${
                                isSelected
                                  ? "bg-primary/10 border-primary/40 font-medium text-primary"
                                  : "bg-card hover:bg-accent border-transparent"
                              }`}
                            >
                              <div className="flex items-center gap-2 overflow-hidden">
                                <Music className={`h-4 w-4 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                                <span className="truncate">{file.name}</span>
                              </div>
                              {isSelected && (
                                <Badge className="text-[10px] px-1.5 py-0 h-5">انتخاب شده</Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </div>

                {/* ===== پخش‌کننده اختصاصی فقط در انتهای بخش پلی‌لیست ===== */}
                <div className="mt-auto pt-4 border-t border-border/80 bg-muted/30 p-3 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Volume2 className="h-4 w-4 text-primary shrink-0 animate-pulse" />
                      <span className="text-xs font-semibold truncate">
                        {selectedFile ? selectedFile.name : "فایلی انتخاب نشده"}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>

                  {selectedFile && (
                    <audio
                      ref={audioRef}
                      src={selectedFile.url}
                      onTimeUpdate={handleTimeUpdate}
                      onEnded={() => setIsPlaying(false)}
                      className="hidden"
                    />
                  )}

                  <div className="flex items-center gap-3">
                    <Button
                      size="icon"
                      variant="default"
                      onClick={togglePlay}
                      disabled={!selectedFile}
                      className="h-10 w-10 rounded-full shrink-0 shadow-sm"
                    >
                      {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 mr-0.5" />}
                    </Button>
                    <div className="flex-1">
                      <Progress
                        value={duration ? (currentTime / duration) * 100 : 0}
                        className="h-2 cursor-pointer"
                        onClick={(e) => {
                          if (!audioRef.current || !duration) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const pos = (e.clientX - rect.left) / rect.width;
                          audioRef.current.currentTime = pos * duration;
                        }}
                      />
                    </div>
                  </div>

                  <Button
                    onClick={handleTranscribe}
                    disabled={!selectedFile || isTranscribing}
                    className="w-full mt-2 h-9 text-xs gap-1.5"
                  >
                    {isTranscribing ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        در حال پیاده‌سازی گفتار...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        پیاده‌سازی این فایل
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ================= ستون سمت چپ: متن خروجی و پردازش هوشمند (حجم ۴ ستون) ================= */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="border-2 border-purple-500/30 dark:border-purple-500/20 shadow-md hover:shadow-lg transition-all rounded-xl overflow-hidden flex flex-col h-full min-h-[500px]">
              <CardHeader className="bg-purple-500/10 dark:bg-purple-500/5 pb-4 border-b border-purple-500/20">
                <CardTitle className="text-lg font-bold flex items-center gap-2 text-purple-700 dark:text-purple-400">
                  <FileText className="h-5 w-5" />
                  متن خروجی و پردازش
                </CardTitle>
                <CardDescription>
                  نمایش متن پیاده‌سازی شده، ترجمه و ویرایش هوشمند
                </CardDescription>
              </CardHeader>

              <CardContent className="p-4 space-y-4 flex-1 flex flex-col">
                <Tabs defaultValue="transcription" className="w-full flex-1 flex flex-col">
                  <TabsList className="grid grid-cols-4 w-full text-xs">
                    <TabsTrigger value="transcription" className="px-1 text-[11px]">متن اولیه</TabsTrigger>
                    <TabsTrigger value="translation" className="px-1 text-[11px]">ترجمه</TabsTrigger>
                    <TabsTrigger value="refinement" className="px-1 text-[11px]">ویرایش</TabsTrigger>
                    <TabsTrigger value="analysis" className="px-1 text-[11px]">تحلیل</TabsTrigger>
                  </TabsList>

                  {/* تب متن اصلی */}
                  <TabsContent value="transcription" className="space-y-3 pt-3 flex-1 flex flex-col">
                    <Textarea
                      value={transcriptionText}
                      onChange={(e) => setTranscriptionText(e.target.value)}
                      placeholder="متن پیاده‌سازی شده صوتی در اینجا ظاهر می‌شود..."
                      className="min-h-[220px] flex-1 resize-none text-sm leading-relaxed"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(transcriptionText);
                          toast.success("متن کپی شد");
                        }}
                        disabled={!transcriptionText}
                      >
                        <Copy className="h-3.5 w-3.5 ml-1" />
                        کپی متن
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={() => {
                          const blob = new Blob([transcriptionText], { type: "text/plain;charset=utf-8" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "transcription.txt";
                          a.click();
                        }}
                        disabled={!transcriptionText}
                      >
                        <Download className="h-3.5 w-3.5 ml-1" />
                        دانلود
                      </Button>
                    </div>
                  </TabsContent>

                  {/* تب ترجمه */}
                  <TabsContent value="translation" className="space-y-3 pt-3 flex-1 flex flex-col">
                    <div className="flex items-center gap-2">
                      <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                        <SelectTrigger className="w-[140px] text-xs h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fa">فارسی</SelectItem>
                          <SelectItem value="en">انگلیسی</SelectItem>
                          <SelectItem value="ar">عربی</SelectItem>
                          <SelectItem value="fr">فرانسوی</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={handleTranslate}
                        disabled={isTranslating || !transcriptionText}
                        className="text-xs h-8 flex-1"
                      >
                        {isTranslating ? <RefreshCw className="h-3.5 w-3.5 animate-spin ml-1" /> : <Languages className="h-3.5 w-3.5 ml-1" />}
                        شروع ترجمه
                      </Button>
                    </div>
                    <Textarea
                      value={translatedText}
                      onChange={(e) => setTranslatedText(e.target.value)}
                      placeholder="متن ترجمه شده در اینجا قرار می‌گیرد..."
                      className="min-h-[180px] flex-1 resize-none text-sm leading-relaxed"
                    />
                  </TabsContent>

                  {/* تب ویرایش هوشمند */}
                  <TabsContent value="refinement" className="space-y-3 pt-3 flex-1 flex flex-col">
                    <Button
                      size="sm"
                      onClick={handleRefine}
                      disabled={isRefining || !transcriptionText}
                      className="w-full text-xs h-8"
                    >
                      {isRefining ? <RefreshCw className="h-3.5 w-3.5 animate-spin ml-1" /> : <Wand2 className="h-3.5 w-3.5 ml-1" />}
                      بهینه‌سازی و علائم‌گذاری متن
                    </Button>
                    <Textarea
                      value={refinedText}
                      onChange={(e) => setRefinedText(e.target.value)}
                      placeholder="متن اصلاح شده و روان..."
                      className="min-h-[180px] flex-1 resize-none text-sm leading-relaxed"
                    />
                  </TabsContent>

                  {/* تب تحلیل */}
                  <TabsContent value="analysis" className="space-y-3 pt-3 flex-1 flex flex-col">
                    <Button
                      size="sm"
                      onClick={handleAnalyze}
                      disabled={isAnalyzing || !transcriptionText}
                      className="w-full text-xs h-8"
                    >
                      {isAnalyzing ? <RefreshCw className="h-3.5 w-3.5 animate-spin ml-1" /> : <Sparkles className="h-3.5 w-3.5 ml-1" />}
                      تحلیل خلاصه و کلمات کلیدی
                    </Button>
                    <Textarea
                      value={analysisText}
                      onChange={(e) => setAnalysisText(e.target.value)}
                      placeholder="خلاصه و تحلیل محتوای گفتار..."
                      className="min-h-[180px] flex-1 resize-none text-sm leading-relaxed"
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </HealthBadgeLayout>
  );
}