---
id: agentenv-architecture
type: architecture-design
status: active
title: agentenv mimarisi
parent: agentenv
---

# agentenv mimarisi

## Şekil

agentenv bir **orkestratördür**: kurulumu kendisi yazmaz, sağlayıcıları çağırır. Yalnız hook birleştirme
kendi kodudur. Beş parça, dördü veri:

- **Katalog** (veri): öğe tanımları ve paketler.
- **Harness tanımları** (veri): algılama yolları, sağlayıcıların beklediği kimlikler, config yolları.
- **Sağlayıcı tanımları** (veri): tür başına birden fazla araç; hangi harness'ları desteklediği, komutları.
- **Ön koşul tanımları** (veri): check komutu + platform başına kurulum komutu.
- **Çekirdek**: `detect → select → plan → bootstrap → apply → record`, TUI'dan bağımsız.

Değer kurulum yapmakta değil, üç türü tek pakette birleştirmekte ve tek durum görünümü vermekte.

## Değişmezler

- Katalog, paket, harness, sağlayıcı, ön koşul tanımları veridir; yeni harness / sağlayıcı / tür eklemek
  **kod değişikliği gerektirmez**.
- **Plan yan etkisizdir** ve ön koşulları da içerir. `apply` yalnız planı uygular.
- Bir hedef için sağlayıcı yoksa plan `kapsanmıyor` der; sessizce atlanmaz.
- Onaysız yazma ve onaysız ön koşul kurulumu yok; her yazma öncesi yedek alınır.
- Skills ve MCP dosyalarını agentenv yazmaz (sağlayıcı yazar); hook birleştirmesi bizim.
- Kapsam bugün sağlayıcı komutunda sabit (`-g` = kullanıcı seviyesi); proje kapsamı açılınca
  `{scope}` değişkeni olarak plana girer, ayrı kod yolu açılmaz.
- Sıralı uygulama hatada durmaz: başarısız öğe `kurulamadı` olarak raporlanır, kalanlar devam eder.
- **Kayıt kanıt değildir.** `already` yalnız sahibi "burada" dediğinde söylenir (`verify` tarifi: skill
  lockfile'ı, harness'ın MCP config'i). Doğrulanamıyorsa öğe yeniden kurulur — yükleyiciler idempotent.
- Okunamayan `state.json` sessizce sıfırlanmaz: dosya `backups/` altına kopyalanır ve uyarı gösterilir.

## Yerleşim

```
catalog/*.yaml      öğe tanımları (kind, kaynak, targets, note, link)
packages/*.yaml     isimli paketler (note, link, items[])
harnesses/*.yaml    harness tanımları
providers/*.yaml    sağlayıcı tanımları (kind, supports, argv şablonları)
requires/*.yaml     ön koşullar (check + platform kurulum komutu)
src/core/           detect, plan, apply, state, status
src/apply/          hook-merger (tek yerli yazıcı)
src/context.ts      Ctx, Runner (gerçek + kayıt eden), argv genişletme
src/cli.ts          komutlar + TUI girişi
~/.agentenv/        state.json, backups/<zaman>/
```

## Şemalar

```yaml
# providers/skills-cli.yaml
id: skills-cli
kind: skill
supports: [claude-code, codex, opencode, pi]      # npx skills agent adları
requires: [node]
priority: 10                                      # aynı tür için birden fazla sağlayıcı varsa sıra
verify: { strategy: skill-lock, file: "~/.agents/.skill-lock.json" }
install: [npx, skills, add, "{source}", -g, -a, "{agentId}", -y, "--skill {skill}"]
remove:  [npx, skills, remove, -g, -a, "{agentId}", "{skill}"]
update:  [npx, skills, update, "{skill}"]
```

```yaml
# providers/add-mcp.yaml
id: add-mcp
kind: mcp
supports: [claude-code, codex, opencode, pi]      # `add-mcp list-agents` ile doğrulandı
requires: [node]
install: [npx, add-mcp, "{package}", -g, -a, "{agentId}", -y]
```

`{package}` alanı hem npm paketini hem uzak MCP URL'sini alır (`add-mcp` ikisini de kabul ediyor);
öğe tanımında `package:` ya da `url:` yazılır.

```yaml
# providers/builtin-hooks.yaml
id: builtin-hooks
kind: hook
supports: [claude-code]
writes: { path: "{harness.config}", section: "hooks.{event}" }
```

```yaml
# requires/node.yaml
id: node
check: { command: [node, --version], min: "20" }
install:
  win32:  [winget, install, OpenJS.NodeJS.LTS, --silent]
  darwin: [brew, install, node]
  linux:  [bash, -lc, "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs"]
```

Komutlar **argv dizisi** olarak yazılır; bir elemanın `{değişken}`i boşsa o eleman düşer (ör. `skill`
tanımlı değilse `--skill {skill}` hiç eklenmez). Öğe tanımları: `kind`, kaynak alanı (`source`+`skill` /
`package` ya da `url` / `event`+`matcher`+`hookCommand`), `targets`, `note`, `link`. Paketler:
`id`, `items[]`, `note`, `link`, isteğe bağlı `default: true` (kimse paket adı vermezse o kurulur) — hepsi
tek nesne, dosya başına bir tanım.

```yaml
# harnesses/claude-code.yaml
id: claude-code
label: Claude Code
detect: [ "~/.claude", "path:claude" ]          # biri yeter
agentId: claude-code                            # npx skills / add-mcp -a değeri
config: { path: "~/.claude/settings.json", format: jsonc }
hooks:  { path: "~/.claude/settings.json", section: "hooks.{event}" }
mcp:    { path: "~/.claude.json", key: "mcpServers" }   # devredilen MCP kurulumunu doğrulamak için
```

```yaml
# catalog/context7.yaml
id: context7
kind: mcp
url: https://mcp.context7.com/mcp
targets: "*"                                    # ya da [claude-code, codex, ...]
note: "Kütüphane dokümanlarını güncel haliyle çeker"
link: https://github.com/upstash/context7
```

```yaml
# packages/base.yaml
id: base
note: "Her makinede istediğim çekirdek set"
link: https://github.com/emilkowalski/skills
items: [emil-skills, context7, bash-log]
```

## Akış

1. **detect** — harness tanımlarındaki `detect` yolları; bulunanlar işaretli, bulunmayanlar soluk.
2. **select** — paket seçilince öğeleri işaretli gelir; harness bazında ya da "hepsine". Çıktı:
   `(kind, öğe, harness)` üçlüleri.
3. **plan** — her üçlü için sağlayıcı çözümlenir (`supports` içinde mi), komut/fark üretilir; kayıt varsa
   sağlayıcının `verify` tarifiyle gerçek kontrol edilir; eksik ön koşullar listelenir. Hiçbir şey yazılmaz.
4. **bootstrap** — onaylanan ön koşullar platform komutuyla kurulur, sonra yeniden check.
5. **apply** — yedek → sıralı uygulama → sonuç satırı (`kuruldu` / `zaten kurulu` / `kapsanmıyor` /
   `hata`).
6. **record** — `state.json`: öğe, harness, sağlayıcı, çalıştırılan komut, tarih. Her başarılı öğeden
   sonra atomik yazılır (tmp + rename).
7. **status** — kayıt + doğrulanabilen gerçek: hook'lar `güncel`/`eksik`, skills/MCP `bilinmiyor`.
   Güncelleme komutları sağlayıcı tanımlarında duruyor (`update:`), henüz plana girmiyor.

## Skill hedefleri ortak

`npx skills` tablosunda `codex`, `pi`, `opencode` aynı global dizini (`~/.agents/skills/`) kullanır,
`claude-code` ayrı (`~/.claude/skills/`). TUI hedefi harness adıyla sorar; dizin eşlemesi sağlayıcı ve
harness tanımında kalır.

## Bilinçli sınırlar

- `npx` yoksa hiçbir sağlayıcı çalışmaz; plan bunu ön koşul olarak söyler (Node kurulumu önerilir).
- Proje kapsamı bugün kapalı: iki sağlayıcı da `-g` alır, yani yalnız kullanıcı seviyesine yazar.
- `status` skills/MCP için `bilinmiyor` der: gerçek onların elinde, doğrulamadan "güncel" demeyiz.
- Hook komutu değişirse eski girdi yerinde değiştirilir (kayıttaki `hookCommand` ile bulunur); komut elle
  değiştirilmişse eski girdi kalır — hook'lar harness şemasında kimlik taşımadığı için tek işaret bu.
- Hook'ta `event`/`matcher`/`hookCommand` eksikse plan `error` der; config'e boş değer yazılmaz.
- Hook birleştirme yalnız JSONC hedefler için yazıldı; başka bir biçim gerekirse `hook-merger`'a yeni bir
  biçim eklenir, çekirdek değişmez.
- MCP sırları (`${VAR}` → `add-mcp --env KEY=${VAR}`) henüz uygulanmadı; öğe tanımında env alanı yok.
- `status` üç durum bilir (`güncel` / `eksik` / `bilinmiyor`); kayıtlı ama komutu değişmiş hook `eksik`
  sayılır — ayrı bir "farklı" durumu yok.
- Dosya erişimi `Ctx` üzerinden enjekte edilmiyor: `plan` hedef dosyayı okuyor, testler geçici HOME ile
  bunu gerçek dosya sistemi üzerinden doğruluyor.
