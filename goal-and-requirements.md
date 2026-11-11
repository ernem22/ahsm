---
id: agentenv
type: goal-and-requirements
status: active
title: agentenv
---

# agentenv

Agent harness'larının skills + MCP + hooks kurulumunu tek yerden yapan, neyin nerede kurulu olduğunu bilen araç.

## Overview

agentenv, bir makinedeki agent harness'larının (Claude Code, Codex CLI, opencode, pi) skills, MCP
sunucuları ve hook'larını tek bir listeden seçip kurar. Öğeler bu depoda **kaynak tanımı** olarak durur
(skill'ler için git deposu/URL, MCP için sunucu paketi, hook için dosya), isimli paketler halinde
gruplanır; TUI listeyi gösterir, seçim harness bazında ya da hepsine birden yapılır.

Skill kurulumunu agentenv kendi yazmaz: `npx skills` gibi olgun araçlara devreder. Kendi yazdığı tek
şey, ortak yükleyicisi olmayan MCP config kaydı ve hook birleştirmesidir.

Kurulumdan sonra agentenv hangi öğenin hangi harness'a, hangi kapsamda kurulduğunu bilir. "Proje içine
mi kuruldu, npx ile mi, harness klasörüne mi" belirsizliği tek doğru kaynağa iner.

## Problem

Kurulum bugün dört ayrı harness'ın dört farklı config formatına dağılmış durumda: her yeni skill, MCP
sunucusu veya hook için dosyalar elle düzenleniyor. İki sonuç doğuyor:

- **Görünürlük kaybı.** Bir öğenin kurulu olup olmadığı, hangi harness'ta ve hangi kapsamda durduğu
  hiçbir yerden tek seferde okunamıyor.
- **Tekrar.** Aynı 8-10 öğe her kurulumda yeniden seçiliyor ve her harness için ayrı ayrı yazılıyor;
  biri unutulduğunda harness'lar arasında sessiz farklar oluşuyor.

## Capabilities

- **Öğe kataloğu.** Her öğe bir kaynak tanımıdır — skills için git deposu/URL (istenirse tek skill
  adıyla), MCP için sunucu paketi ve config şablonu, hook için olay + eşleşme + komut. Yanında ad,
  hedef harness'lar, kısa not ve istenirse link bulunur.
- **Paketler.** İsimli öğe listeleri tek bir YAML dosyasında tanımlanır; her paketin kendi notu ve
  linki olabilir. TUI'de paket seçildiğinde içeriği işaretli gelir, kullanıcı tek tek değiştirebilir.
- **TUI.** Harness'ları ve öğeleri listeler, paket notlarını gösterir, seçim alır. Kurulum öncesi
  yapılacak işi (çalışacak komut, hook için yazılacak girdi) gösterip onay ister; hedef dosyanın farkı gösterilmez,
  çünkü skills/MCP dosyasını sağlayıcı yazar. Yalnız kendi yazdığı hook dosyasını, üzerine yazmadan önce
  yedekler.
- **Tek seferde çoklu kurulum.** Seçilenler tek bir harness'a ya da tüm harness'lara birden yazılabilir.
- **Kurulumu devretme (skills + MCP).** Skill dosyalarını ve MCP kayıtlarını agentenv yazmaz; sağlayıcı
  araçları çağırır (`npx skills add <kaynak> -g -a <harness>`, `npx add-mcp <paket>`). Symlink/kopya,
  check/update/remove o araçların işi.
- **Sağlayıcı modeli.** Her öğe türü için birden fazla sağlayıcı tanımlanabilir; her sağlayıcı hangi
  harness'ları desteklediğini bildirir. Desteklenmeyen ikili sessizce atlanmaz, "kapsanmıyor" olarak
  gösterilir.
- **Hook'lar.** Çok-harness bir hook kurucusu yok; agentenv hook'ları `settings.json`'a birleştirir —
  hedef dosya ve yazılacak girdi gösterilir, onay istenir, yedek alınır, dosyadaki diğer ayarlar korunur.
- **Ön koşullar.** Eksik olan araçlar (Node/npx, uv, gerekli harness binary'si) plan aşamasında
  listelenir ve onay sonrası kurulur; kurulum tarifi platform başına veridir.
- **Doğru formata yazma.** Her harness kendi formatını alır; MCP anahtarı düz metin yazılmaz, `${VAR}`
  referansı ve gerekli değişken adları plan çıktısında görünür.
- **Kaldırma.** Kurulan öğeler geri alınabilir: skills için `npx skills remove`, MCP için
  `npx add-mcp remove`, hook'lar için kayıtlı girdinin config'ten silinmesi. Kaldırma **her harness'ı**
  kapsar (skill dizinleri ortak); plan etkilenen dizinleri ve harness'ları önceden gösterir.
- **Durum.** Kurulu öğelerin harness + kapsam haritası tek komutla görülebilir. Kayıt ile
  doğrulanabilen gerçek karşılaştırılır: `güncel` / `eksik` / `bilinmiyor`. Üç durum yeter: kayıtlı ama
  içeriği değişmiş hook da `eksik` sayılır, doğrulanamayan skills/MCP `bilinmiyor` der.
- **Sırlar.** MCP config'ine düz anahtar yazılmaz; `${ENV_VAR}` referansı yazılır ve TUI hangi
  değişkenin gerektiğini söyler.
- **Genişletilebilirlik.** Yeni bir harness, yeni bir kapsam (ör. proje seviyesi) veya yeni bir öğe türü
  eklemek kod yazmayı gerektirmez; tanım dosyası eklemek yeter.

## Alternatives Considered

Aynı işin parçalarını yapan araçlar var; hiçbiri dördünü birden kapatmıyor (yerel dosyadan paket + TUI + çoklu harness + durum doğruluğu).

| Araç | Ne yapıyor | agentenv'de eksik kalan | Link |
|---|---|---|---|
| `skills` (vercel-labs) | `npx skills add` ile git repolarından skill kurar, 75+ harness, lockfile | Skills dışına çıkmıyor: MCP kaydı, hook birleştirme ve yerel paket tanımı yok | https://github.com/vercel-labs/skills |
| Bridle | Profiller, skills/agents/commands/MCP'yi Claude Code, OpenCode, Goose, Amp, Copilot CLI arasında çevirir | Öğeler GitHub'dan gelir (yerel dosya kütüphanesi yok); hook birleştirme ve TUI yok | https://github.com/neiii/bridle |
| skillz | Skills/plugin/hook/MCP/subagent kur-kaldır, isimli profiller | Yalnızca Claude Code + Codex; TUI yok, seçim profille sınırlı | https://github.com/killallgit/skillz |
| harness-ai-kit | Typed asset şeması, bağımlılık çözümü ve lockfile ile "agent asset paket yöneticisi" | Kurulum ağırlıklı, yerel tek dosya paket + not/link fikri yok | https://github.com/seed-forge/harness-ai-kit |
| skill-manager | Harness'lar arası envanter: ne kullanımda, nerede aktif; aç/kapat | Masaüstü uygulaması; terminal/TUI akışı ve tek komutla kurulum yok | https://github.com/mode-io/skill-manager |
| chezmoi / `mise dotfiles` | Genel dotfile yönetimi, şablonlama, sürüm izleme | Harness farkında değil: skills/MCP/hook formatlarını bilmez, seçim yaptırmaz | https://mise.jdx.dev/dotfiles.html |

## Tech Notes

| Konu | Karar | Gerekçe |
|---|---|---|
| Dil / dağıtım | TypeScript + Ink; Node ≥20, `npx agentenv` ile kurulumsuz çalışır | Harness config'leri zaten JSON; tek dil hem TUI'yi hem kurulum kodunu taşıyor. Her ortamda çalışması Node varlığına bağlı, Node'suz makine hedef değil. |
| Harness tanımları | Veri dosyaları (`harnesses/*.yaml`): algılama yolları (`~/klasör` veya `path:binary`), sağlayıcıların beklediği `agentId`, hook bölümü | Yeni harness = yeni dosya; çekirdek kod harness adı bilmez. |
| Öğe türleri | Her tür için bir yerleşim tanımı: `skill` = `npx skills`, `mcp` = `npx add-mcp`, `hook` = `settings.json` birleştirme | Yeni tür eklemek yeni tanım eklemek olur, `if` zinciri değil. |
| Sağlayıcılar | Tür başına birden fazla sağlayıcı, her biri desteklediği harness'ları ve komutlarını bildirir | `add-mcp` desteklemediği harness'ta `mcpm`'e, ya da ileride başka bir araca düşülebilsin |
| Skill kurulumu | `skills` paketinin programatik API'si (`installSkills`/`removeSkills`), birincil; `npx skills` yedek | Yapısal sonuç (`failed[]`), doğru kaldırma semantiği (paylaşılan kopya başka agent kullanıyorsa kalır) ve alt süreç yok. Node ≥22.20 gerektirir. |
| Paketler | `packages/*.yaml`: `id`, `items[]`, `note`, `link` — dosya başına tek paket | İnsan tarafından okunur/düzenlenir; TUI notu ve linki buradan gösterir. |
| Kurulum durumu | `~/.agentenv/state.json` (öğe, harness, sağlayıcı, komut, tarih) + doğrulanabilen hedef; hook'lar `güncel`/`eksik`, skills/MCP `bilinmiyor` | Doğrulamadığımız şeye "güncel" dememek, kaydı gerçeğin yerine koymamak için. |
| Kapsam | Bugün yalnız kullanıcı seviyesi: iki sağlayıcı komutuna `-g` sabit yazılı | Proje kapsamı açılınca `{scope}` değişkeni olur; ayrı kod yolu açılmaz. |
| Platform | Windows / macOS / Linux yol farkları tek bir yol katmanında | Geliştirme Windows'ta, kullanım başka makinelerde olabilir. |
| i18n | Tüm kullanıcı metinleri `src/i18n.ts`'te tek tablo, bugün yalnızca İngilizce | Çoklu dil sonradan eklenebilsin, metinler koda gömülmesin. |
