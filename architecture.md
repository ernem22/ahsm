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
- Onaysız yazma ve onaysız ön koşul kurulumu yok. agentenv'in kendi yazdığı hook dosyası ile bozuk
  `state.json`, yazılmadan önce yedeklenir; skills/MCP dosyalarını sağlayıcı yazar.
- Skills ve MCP dosyalarını agentenv yazmaz (sağlayıcı yazar); hook birleştirmesi bizim.
- Doğrulama hızlı kaynaktan okunur: skills için lockfile (~1 ms), MCP için harness config'i. `listSkills()`
  plan için kullanılmaz — 103 skill'de ~7 s sürüyor; API kurulum/kaldırma yolunda kullanılır.
- Kapsam bugün sağlayıcı komutunda sabit (`-g` = kullanıcı seviyesi); proje kapsamı açılınca
  `{scope}` değişkeni olarak plana girer, ayrı kod yolu açılmaz.
- Sıralı uygulama hatada durmaz: başarısız öğe `hata` olarak raporlanır, kalanlar devam eder.
- **Kayıt kanıt değildir.** `already` yalnız sahibi "burada" dediğinde söylenir (`verify` tarifi: skill
  lockfile'ı, harness'ın MCP config'i). Doğrulanamıyorsa öğe yeniden kurulur — yükleyiciler idempotent.
- Bozuk `state.json` sessizce sıfırlanmaz: okunup ayrıştırılamayan dosya `apply` sırasında `backups/`
  altına kopyalanır ve uyarı gösterilir. Hiç okunamayan (izin / G-Ç hatası) ya da yedeklenemeyen dosyaya
  dokunulmaz: kurulumlar yine çalışır, bu çalıştırmanın kayıtları yazılmaz ve uyarı gösterilir. `plan` ve
  `status` hiçbir durumda yazmaz.

## Yerleşim

```
catalog/*.yaml      öğe tanımları (kind, kaynak, targets, note, link)
packages/*.yaml     isimli paketler (note, link, items[])
harnesses/*.yaml    harness tanımları
providers/*.yaml    sağlayıcı tanımları (kind, supports, argv şablonları)
requires/*.yaml     ön koşullar (check + platform kurulum komutu)
src/core/           detect, plan, apply, remove, state, status, verify
src/apply/          hook-merger + config-writer (tek yerli yazıcı)
src/providers/      skills-api adaptörü (in-process, `skills` paketi)
src/context.ts      Ctx, Runner (gerçek + kayıt eden), argv genişletme
src/cli.ts          komutlar + TUI girişi
~/.agentenv/        state.json, backups/<zaman>/
```

## Şemalar

Bir sağlayıcı argv yerine gömülü bir adaptör bildirebilir: `adapter: skills-api` (öncelik 5). Bu,
skills paketinin programatik API'sini kullanır (`installSkills` / `removeSkills`); `skills-cli`
(öncelik 10) aynı işi komutla yapan yedek yoldur.

```yaml
# providers/skills-cli.yaml
id: skills-cli
kind: skill
supports: [claude-code, codex, opencode, pi]      # npx skills agent adları
requires: [node]
priority: 10                                      # aynı tür için birden fazla sağlayıcı varsa sıra
verify: { strategy: skill-lock, file: "~/.agents/.skill-lock.json" }
install: [npx, skills, add, "{source}", -g, -a, "{agentId}", -y, "--skill {skill}"]
remove:  [npx, skills, remove, -g, -y, "{skill}"]         # kaldırma her harness'ı kapsar
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
supports: [claude-code, codex]
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

`AGENTENV_ROOT` veri kökünü değiştirir (fotoğraf/test setleri için); `{root}` değişkeni argv'de o kökü
verir. Komutlar **argv dizisi** olarak yazılır; bir elemanın `{değişken}`i boşsa o eleman düşer (ör. `skill`
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
3. **plan** — her üçlü için sağlayıcı çözümlenir (`supports` içinde mi), komut (hook için yazılacak girdi) üretilir; kayıt varsa
   sağlayıcının `verify` tarifiyle gerçek kontrol edilir; eksik ön koşullar listelenir. Hiçbir şey yazılmaz.
4. **bootstrap** — onaylanan ön koşullar platform komutuyla kurulur, sonra yeniden check.
5. **apply** — sıralı uygulama; her hook yazımından önce hedef dosya, bozuk `state.json` kaydından önce
   o dosya yedeklenir. Sonuç satırı: `kuruldu` / `zaten kurulu` / `kapsanmıyor` / `hata`. CLI
   (`apply --yes`) çıkış kodu: bir öğe `hata` verdiyse ya da bir ön koşul karşılanmadıysa 1, yalnız
   uyarı varsa 0; etkileşimli TUI çıkış kodu ayarlamaz.
6. **record** — `state.json`: öğe, harness, sağlayıcı, çalıştırılan komut, tarih. Her başarılı öğeden
   sonra atomik yazılır (tmp + rename); kayıt devre dışıysa (`state.json` okunamıyorsa, bozuk dosya
   yedeklenemiyorsa ya da kayıt yazılamıyorsa) yazılmaz. İstisna: hedefte zaten bulunan bir hook (elle
   ya da eski bir çalıştırmadan) için komut çalışmaz; yalnız `hookCommand` kaydedilir (`command` boş), böylece komut
   sonradan değişince eski girdi bulunup yerinde değiştirilir. Bu kayıt var olduğuna kanıt sayılmaz:
   `status`/`plan` hedef dosyayı yine kendileri okur.
7. **status** — kayıt + doğrulanabilen gerçek: `verify` tarifi olan sağlayıcılarda `güncel`/`eksik`,
   olmayanlarda `bilinmiyor`. Güncelleme komutları sağlayıcı tanımlarında duruyor (`update:`), henüz
   plana girmiyor.

## Skill hedefleri ortak

`npx skills` tablosunda `codex`, `pi`, `opencode` aynı global dizini (`~/.agents/skills/`) kullanır,
`claude-code` ayrı (`~/.claude/skills/`). TUI hedefi harness adıyla sorar; dizin eşlemesi sağlayıcı ve
harness tanımında kalır.

## Test

- `npm test` — birim/entegrasyon: `node:test`, geçici HOME + kayıt eden runner, ağ yok.
- `npm run e2e` — `scripts/e2e.mjs`, `test/fixtures/offline` ile **ağsız** 11 senaryo: kurulum, idempotens,
  doğrulama, kendini onarma, bozuk JSONC, bozuk state, eksik ön koşul, plan/status'un yazmaması.
- `npm run e2e:network` — üsttekine ek olarak gerçek `npx skills` / `npx add-mcp` ile geçici bir HOME'da
  kurulum, `status` ve ikinci çalıştırmanın hiçbir şey yapmaması.

## Harness'lar

| harness | algılama | skills | MCP | hooks |
|---|---|---|---|---|
| claude-code | `~/.claude`, `path:claude` | `~/.claude/skills` | `~/.claude.json` → `mcpServers` (JSONC) | `settings.json` |
| codex | `~/.codex`, `path:codex` | `~/.codex/skills` + ortak | `config.toml` → `[mcp_servers]` (**TOML**) | `hooks.json` |
| pi | `~/.pi`, `path:pi` | ortak + `~/.pi/agent/skills` | `~/.pi/agent/mcp.json` → `mcpServers` | yok — extension |
| opencode | `~/.config/opencode`, `path:opencode` | ortak + `~/.config/opencode/skills` | `opencode.jsonc` → `mcp` | yok — plugin |

## Keşif, plugin ve yetenek yoklaması (karar — henüz uygulanmadı)

Bu üç kural karara bağlandı ama kodda yok; uygulanana kadar plan/apply bugünkü gibi çalışır.

- **Keşif yalnız taslak üretir.** Resmî MCP registry (`registry.modelcontextprotocol.io`) ve SkillFed
  (`skillfed.io/api/...`) arama için okunur; bulunan sunucu/skill kataloğa *taslak* olarak girer,
  kurulum yine `apply` üzerinden yapılır. Katalogda olmak güvenlik denetimi değildir.
- **Plugin ayrı bir öğe türüdür.** Kurulum birimi harness'ın plugin CLI'ıdır; önizleme paketin içindeki
  skill/MCP/hook envanterini gösterir (`claude plugin details`, `codex plugin list --json`). Plugin,
  bizim `package`'ımız değildir.
- **Yetenek yoklaması.** Bir harness CLI'ının alt komutu varsayılmaz; sürümde var mı diye yoklanır
  (`--help`/`--version`), sonuç önbelleğe alınır ve yoksa plan `kapsanmıyor (bu sürümde)` der. Sebep
  somut: OpenCode 1.19.0 `plugin <module>` dışında bir şey bilmiyor, güncel doküman ise
  `plugin add/list/remove` belgeliyor.
- **skills.sh REST API'si kullanılmıyor.** Kurulum/kaldırma `skills` paketinin fonksiyonlarıyla
  yapılıyor; `/api/v1/*` uçlarının istediği Vercel OIDC token'ı bizim yolumuzda devrede değil.

## Bilinçli sınırlar

- `npx` yoksa hiçbir sağlayıcı çalışmaz; plan bunu ön koşul olarak söyler (Node kurulumu önerilir).
- Proje kapsamı bugün kapalı: iki sağlayıcı da `-g` alır, yani yalnız kullanıcı seviyesine yazar.
- `status`/`plan` bir kurulumu yalnız sağlayıcının kendi envanteri doğruluyorsa "kurulu" sayar; `verify`
  tarifi olmayan sağlayıcıda `bilinmiyor` der ve plan öğeyi yeniden kurar.
- `skill-lock` doğrulaması harness'e göre ayırmaz: lockfile'da hangi harness için kurulduğu yazmaz
  (`~/.agents/.skill-lock.json`, öğe başına yalnız kaynak ve skill adı). `codex` için kurulmuş bir skill
  `claude-code` için de `zaten kurulu` görünebilir; `~/.claude/skills/` ayrıca bakılmaz. Öğede `skill`
  alanı yoksa kaynak repodan herhangi bir skill'in kayıtlı olması yeter (kısmi kurulum da "var" sayılır).
  Lockfile konumu `$XDG_STATE_HOME` ile değişebilir; `verify` bunu okumaz.
- Hook komutu değişirse eski girdi yerinde değiştirilir (kayıttaki `hookCommand` ile bulunur); komut elle
  değiştirilmişse eski girdi kalır — hook'lar harness şemasında kimlik taşımadığı için tek işaret bu.
- Hook'ta `event`/`matcher`/`hookCommand` eksikse plan `error` der; config'e boş değer yazılmaz.
- Hook'lar yalnız JSON ile yapılandırılan harness'larda (claude-code, codex). pi ve opencode hook'u
  extension/plugin olarak yapıyor — yani kod; agentenv kod yazmaz, plan `kapsanmıyor` der.
- MCP doğrulaması üç biçim okur: JSON, JSONC ve TOML (codex). Yeni bir biçim gelirse `verify`'a bir
  okuyucu eklenir.
- Hook birleştirme yalnız JSONC hedefler için yazıldı; başka bir biçim gerekirse `hook-merger`'a yeni bir
  biçim eklenir, çekirdek değişmez.
- `skills` paketi Node ≥22.20 istiyor; `engines` ve `requires/node` bu yüzden 22.20. CLI sağlayıcısı
  yedek olarak duruyor ama bugün hiçbir harness'ta seçilmiyor (API dördünü de kapsıyor).
- MCP sırları (`${VAR}` → `add-mcp --env KEY=${VAR}`) henüz uygulanmadı; öğe tanımında env alanı yok.
- `status` üç durum bilir (`güncel` / `eksik` / `bilinmiyor`); kayıtlı ama komutu değişmiş hook `eksik`
  sayılır — ayrı bir "farklı" durumu yok.
- Dosya erişimi `Ctx` üzerinden enjekte edilmiyor: `plan` hedef dosyayı okuyor, testler geçici HOME ile
  bunu gerçek dosya sistemi üzerinden doğruluyor.
