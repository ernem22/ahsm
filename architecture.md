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
  plan için kullanılmaz — 103 skill'de ~7 s sürüyor; API kurulum/kaldırma yolunda, açık `list`
  komutunda ve `remove --skill`in kayıtta karşılığı olmayan adlarında kullanılır. `plan`, `status` ve
  `stale` onu hiç çağırmaz.
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
src/core/           detect, plan, apply, remove, state, status, verify, list
src/apply/          hook-merger + config-writer (tek yerli yazıcı)
src/providers/      skills-api adaptörü (in-process, `skills` paketi)
src/context.ts      Ctx, Runner (gerçek + kayıt eden), argv genişletme
src/cli.ts          komutlar + TUI girişi
~/.agentenv/        state.json, backups/<zaman>/
```

## Şemalar

Bir sağlayıcı argv yerine gömülü bir adaptör bildirebilir: `adapter: skills-api` (öncelik 5). Bu,
skills paketinin programatik API'sini kullanır (`installSkills` / `removeSkills`); `skills-cli`
(öncelik 10) aynı işi komutla yapan yedek yoldur. `check:` yalnız `skills-cli`'da durur: paket
programatik bir güncelleme kontrolü sunmuyor (`resolveSource` içeriği vermez), karşılaştırmayı yapan
tek yüzey `skills check` alt komutudur. Bu yüzden `stale` sağlayıcıyı yetenekle seçer
(`pickProvider(data, 'skill', { capability: 'check' })`), kurulum yolundan bağımsız olarak.

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
check:   [npx, skills, check, -g]
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
   sağlayıcının `verify` tarifiyle gerçek kontrol edilir; eksik ön koşullar listelenir. Her ön koşul satırı
   okunan sürümü, tanımın asgarisini (`check.min`) ve eksikse güncelleme komutunu taşır; tanımın bu
   platform için `install` argv'si yoksa satır komut uydurmaz, `no install command` der — `apply` de aynı
   sebebi raporlar ve o ön koşula bağlı öğeler `hata` olur. Kurulum yalnız tanımdaki varsayılan komutla
   yapılır; harness başına ikinci bir yol yok. Bir harness'ın asgari sürümü karşılanmıyorsa satır
   `çok eski` der (status ile aynı sözcük). O ön koşula bağlı öğeler `bloklu` olarak ve sebebiyle
   gösterilir; başka bir harness'ın öğeleri etkilenmez. Hiçbir şey yazılmaz.
4. **bootstrap** — ön koşullar planın bildirdiği iki duruma göre ele alınır: **eksik** (check kullanılabilir
   sürüm üretmedi) her zaman platform komutuyla bir kez kurulur; **eski** (sürüm okundu ama `check.min`in
   altında) yalnız kullanıcı işaretlediyse güncellenir. Kurulumdan sonra sürüm yeniden check edilir.
   `apply --yes` varsayılanı hiçbir eski ön koşulu işaretlemez; `--update <id,id>` yalnız adı geçenleri,
   `--update all` bütün teklifleri işaretler, `--update none` hiçbirini. İşaretlenmeyen eski ön koşul
   güncellenmez, bağımlı öğeler sebebiyle birlikte `hata` olarak raporlanır; eksikler, diğer harness'lar ve
   engellenmemiş öğeler devam eder.
5. **apply** — sıralı uygulama; her hook yazımından önce hedef dosya, bozuk `state.json` kaydından önce
   o dosya yedeklenir. Sonuç satırı: `kuruldu` / `zaten kurulu` / `kapsanmıyor` / `hata`. Skill kurulumu
   yükleyicinin sözüyle bitmez: komut 0 dönse de (ya da adaptör "kuruldu" dese de) sağlayıcının envanteri
   (lockfile) kontrol edilir — orada görünmüyorsa öğe `hata` olur ve **kaydedilmez**; "zaten kurulu" da
   yalnız envanter doğruladığında söylenir. MCP ve hook bugün komutun kendi sonucuyla yetinir. CLI
   (`apply --yes`) çıkış kodu: bir öğe `hata` verdiyse ya da bir ön koşul karşılanmadıysa 1, yalnız
   uyarı varsa 0; etkileşimli TUI çıkış kodu ayarlamaz. "Bloklu" ayrı bir kapı değildir: apply, kendi
   ön koşul sonucuna bakıp öğeyi çalıştırmaz — plan yalnız aynı sonucu önceden gösterir.
6. **record** — `state.json`: öğe, harness, sağlayıcı, çalıştırılan komut, tarih. Her başarılı öğeden
   sonra atomik yazılır (tmp + rename); kayıt devre dışıysa (`state.json` okunamıyorsa, bozuk dosya
   yedeklenemiyorsa ya da kayıt yazılamıyorsa) yazılmaz. İstisna: hedefte zaten bulunan bir hook (elle
   ya da eski bir çalıştırmadan) için komut çalışmaz; yalnız `hookCommand` kaydedilir (`command` boş), böylece komut
   sonradan değişince eski girdi bulunup yerinde değiştirilir. Bu kayıt var olduğuna kanıt sayılmaz:
   `status`/`plan` hedef dosyayı yine kendileri okur.
7. **status** — iki bölüm, ikisi de yan etkisiz: **harness'lar** ve **öğeler**.
   - *harness'lar*: her harness tanımı için var/yok (mevcut `detect` yoklaması), kendi CLI'sının bildirdiği
     sürüm, tanımın `requires` ile bağladığı ön koşulun `check.min` asgarisini karşılayıp karşılamadığı
     (`hazır` / `çok eski` / `yok`) ve karşılamıyorsa çalıştıracağımız güncelleme komutu
     (ön koşulun bu platformdaki `install` argv'si). Asgari sürüm veridir; kodda sayı yok.
   - *öğeler*: kayıt + doğrulanabilen gerçek: `verify` tarifi olan sağlayıcılarda `güncel`/`eksik`,
     olmayanlarda `bilinmiyor`. Güncelleme komutları sağlayıcı tanımlarında duruyor (`update:`), henüz
     plana girmiyor.

   İki bölüm de tek biçimlendiriciden (`src/render.ts`) geçer; CLI satırı yazar, TUI tonu renge çevirir.
8. **list** — açık komut (`agentenv list`, `src/core/list.ts`): sağlayıcının kendi envanteri (`listSkills`)
   okunur ve satır başına skill adı, kapsam ve o skill'i taşıyan harness'lar yazılır. Kaynak envanter
   olduğu için agentenv dışında (elle, başka bir CLI'yla) kurulmuş skill'ler de görünür; hiçbir harness'ın
   bildirmediği skill `no harness reports it` olarak yine listelenir, tanımsız sağlayıcı ajanı kendi adıyla
   görünür. Kayıt okunmaz (ADR-0002) ve hiçbir şey yazılmaz: bozuk `state.json` listeyi değiştirmez, yedek
   bile alınmaz ve hiçbir komut çalıştırılmaz. Kapsam bugün yalnız kullanıcı seviyesidir (sağlayıcı `-g`),
   satır bunu söyler. Envanter yavaş olduğu için bu okuma `plan`/`status`'a girmez — `list` tek kapıdır.
9. **stale** — açık komut (`agentenv stale`, `src/core/stale.ts`): her kayıtlı skill için "kaynak hâlâ aynı
   şeyi mi sunuyor?" sorusuna `güncel` / `bayat` / `bilinmiyor` cevabı verilir. Karşılaştırma bizim değil,
   sağlayıcının kendi hesabıdır: `skills check -g` (sağlayıcı tanımındaki `check:` argv'si) kurulumda
   kaydedilen `skillFolderHash`i kaynağın bugünkü ağaç özetiyle karşılaştırır ve hiçbir şey kurmaz.
   Biz yalnız lockfile'ı (~1 ms) okuruz; `listSkills()` yine çağrılmaz, `state.json` hiç okunmaz ve hiçbir
   şey yazılmaz (ne kurulum, ne lockfile, ne kayıt). Üç durum dürüstçe ayrılır: `bayat` yalnız sağlayıcı
   o skill için güncelleme/silinme bildirdiğinde, `güncel` yalnız kontrol o kaynağın skill'leri için
   tamamlandığında, gerisi `bilinmiyor` (kaynağa ulaşılamadı, komut bitmedi, kayıtta hash/kaynak yok).
   Sağlayıcı `check:` sunmuyorsa satırlar değil "not covered" yazılır.
10. **update** — açık komut (`agentenv update`, `src/core/update.ts`): `stale`in **bayat** dediği skill'ler aynı
    kurulum yolundan yeniden kurulur. Karşılaştırma yine sağlayıcının kendi kontrolüdür; iş yine `buildPlan`
    + `applyPlan`: bayat satırlar katalog öğesine ve kayıttaki harness'lara eşlenir, yalnız o (öğe, harness)
    çiftleri için plan kurulur ve `zaten kurulu` diyen girdiler `run`'a çevrilir — ayrı bir güncelleme
    mekanizması, ikinci bir yükleyici yok; sağlayıcının `install` argv'si/adaptörü ve `state.json` kaydı aynı.
    Onay bir tanedir: `--yes` yoksa yalnız plan basılır (kontrol ve plan hiçbir şey yazmaz), varsa her çift bir
    kez kurulur ve kaydı tazelenir; bir skill'in hatası diğerlerini durdurmaz, çıkış kodu 1 olur. **İşaretsiz**
    hiçbir skill'e dokunulmaz: `güncel` ve `bilinmiyor` satırları plana hiç girmez. Katalogda öğesi olmayan,
    kaydında harness bulunmayan ya da o harness burada tanımlı olmayan bayat skill sessizce atlanmaz — satır
    sebebiyle birlikte (`not covered` anlamında) yazılır.
11. **remove** — açık komut (`agentenv remove`, `src/core/remove.ts`): iki duruma **aynı kurallarla** cevap
    verir. Kayıtlı her öğe kaldırılır (`--package` ile daraltılabilir); `--skill <ad,ad>` ise adı verilen
    skill'i kaldırır, agentenv onu kurmamış olsa bile. Tek kapı `planRemoval`dır: kayıt adı zaten kapsıyorsa
    kayıtlı kurallar (aynı sağlayıcı, aynı yollar, aynı kayıt temizliği) işler; kapsamıyorsa plan `list`in
    okuduğu envanteri okur ve harness'ları/dizinleri oradan doldurur. Envanter yalnız ad kayıtta yoksa
    okunur. Kaldırma her harness'ı kapsar (skill dizinleri ortak) ve plan önce etkilenen harness'ları,
    dizinleri ve komutu yazar; `--yes` yoksa hiçbir şey yazılmaz. Kaldırılamayan şey satırdır, durma değil:
    sağlayıcısı yoksa `not covered`, adaptör envanterde bulamazsa `not installed`, sağlayıcı hata verirse
    `error` — kalanlar yine çalışır. Kaydı olmayan ad `state.json`ı hiç yazmaz, kayıttan giden öğe kaydını
    temizler: sonrasında `status` hayalet göstermez. Envanter okuması başarısız olursa uyarı yazılır ve ad
    yine planlanır.

## Skill hedefleri ortak

`npx skills` tablosunda `codex`, `pi`, `opencode` aynı global dizini (`~/.agents/skills/`) kullanır,
`claude-code` ayrı (`~/.claude/skills/`). TUI hedefi harness adıyla sorar; dizin eşlemesi sağlayıcı ve
harness tanımında kalır.

## Test

- `npm test` — birim/entegrasyon: `node:test`, geçici HOME + kayıt eden runner, ağ yok.
- `npm run e2e` — `scripts/e2e.mjs`, `test/fixtures/offline` ile **ağsız** 22 senaryo: kurulum, idempotens,
  doğrulama, kendini onarma, bozuk JSONC, bozuk state, eksik ön koşul, plan/status'un yazmaması,
  status'un harness bölümü (hazır / çok eski + güncelleme komutu / yok), eski harness'ın planda
  sürüm/asgari/güncelleme komutuyla görünüp öğelerini bloklaması, `--update` verilmeden güncellemenin
  çalışmaması, eksik ön koşulun işaretsiz bootstrap edilmesi, `--update all`ın güncellemeyi bir kez
  çalıştırıp aynı çalıştırmada öğeleri kurması, bu platformda kurulum komutu olmayan tanımın plan ve
  apply'da `no install command` demesi, kurulamayan bir harness'ın diğer harness'ın öğelerini
  bırakmaması ve hiçbir şey yazmayan bir skill kurulumunun `kuruldu` sayılmaması.
- `node scripts/e2e-list.mjs` — `list` için ayrı, ağsız dört senaryo (`npm run e2e`'ye bağlı):
  elle kurulmuş skill'in adı ve kapsamıyla görünmesi, hiçbir şey yazmaması, bozuk `state.json` ile
  çalışmaya devam etmesi ve `plan`/`status`'un envanteri hiç okumaması. Envanter makinenin gerçek
  `~/.agents` deposunu da okuduğu için bu senaryolar tam liste yerine davranışı doğrular.
- `node scripts/e2e-stale.mjs` — `stale` için ayrı, ağsız yedi senaryo (`npm run e2e`'ye bağlı): fixture
  `check` komutuyla güncelleme bildiriminin `bayat` olması, kontrol tamamlandığında `güncel` ve ağacın
  hiç değişmemesi, envanterin hiç okunmaması, kaynağa ulaşılamazken sağlayıcı "all up to date" dese de
  `bilinmiyor` olması, kontrol hiç bitmezse `bilinmiyor`, hash kayıtlı değilse karşılaştırma yapılmaması
  ve bozuk `state.json`ın sonucu değiştirmemesi. Ağsız bir `check` "kaynağa ulaşılamıyor" demektir; bu,
  `bilinmiyor`un gerçek senaryosudur.
- `node scripts/e2e-update.mjs` — `update` için ayrı, ağsız dört senaryo (`npm run e2e`'ye bağlı): bayat
  skill yokken hiçbir şey yapmaması ve ağacın değişmemesi, planın bayat skill'i kurulum satırı olarak
  göstermesi ve hiçbir şey yazmaması, `--yes` ile skill'in gerçekten bir kez kurulması (elle silinen dosya
  geri gelir) ve işaretsiz MCP öğesine dokunulmaması, ardından `status`un `güncel` demesi.
- `node scripts/e2e-remove.mjs` — `remove` için ayrı, ağsız beş senaryo (`npm run e2e`'ye bağlı): planın
  etkilenen harness'ları ve dizinleri onaydan önce göstermesi ve hiçbir şey yazmaması, `--yes` ile her
  kayıtlı öğenin kalkması ve kaydın boşalması, agentenv'in kurmadığı skill'in adıyla kaldırılması (kayıt
  yaratmadan), bir adın sağlayıcı hatasıyla raporlanıp diğerinin yine kaldırılması ve sağlayıcısı olmayan
  adın `not covered` demesi.
- `scripts/check-syntax.mjs` (`npm run check:scripts`) — `scripts/*.mjs` ve `test/fixtures/offline/bin/*.mjs`
  dosyalarını `node --check` ile ayrıştırır: bu programları e2e `spawn` ile çalıştırdığı için typecheck
  onları hiç görmez.
- `npm run e2e:network` — üsttekine ek olarak gerçek `npx skills` / `npx add-mcp` ile geçici bir HOME'da
  kurulum, `status` ve ikinci çalıştırmanın hiçbir şey yapmaması.

## Harness'lar

| harness | algılama | skills | MCP | hooks |
|---|---|---|---|---|
| claude-code | `~/.claude`, `path:claude` | `~/.claude/skills` | `~/.claude.json` → `mcpServers` (JSONC) | `settings.json` |
| codex | `~/.codex`, `path:codex` | `~/.codex/skills` + ortak | `config.toml` → `[mcp_servers]` (**TOML**) | `hooks.json` |
| pi | `~/.pi`, `path:pi` | ortak + `~/.pi/agent/skills` | `~/.pi/agent/mcp.json` → `mcpServers` | yok — extension |
| opencode | `~/.config/opencode`, `path:opencode` | ortak + `~/.config/opencode/skills` | `opencode.jsonc` → `mcp` | yok — plugin |

## Keşif, plugin ve sürüm desteği (karar — henüz uygulanmadı)

Plugin ve keşif park edildi; sıra önce harness + skill temeline verildi. "Yetenek yoklaması" fikri
**bırakıldı**: birden fazla CLI kuşağını desteklemek fazladan yük. Bunun yerine **stabil sürüm** hedefi
geçerli — harness tanımı asgari sürümü mevcut `requirement` kontrolüyle bildirir; sürüm eskiyse plan
güncellemeyi önerir, kullanıcı işaretlerse güncellenir, akış devam eder. Aşağıdaki üç kural yalnız
plugin/keşif işi geldiğinde geçerli olacak.

- **Keşif yalnız taslak üretir.** Resmî MCP registry (`registry.modelcontextprotocol.io`) ve SkillFed
  (`skillfed.io/api/...`) arama için okunur; bulunan sunucu/skill kataloğa *taslak* olarak girer,
  kurulum yine `apply` üzerinden yapılır. Katalogda olmak güvenlik denetimi değildir.
- **Plugin ayrı bir öğe türüdür.** Kurulum birimi harness'ın plugin CLI'ıdır; önizleme paketin içindeki
  skill/MCP/hook envanterini gösterir (`claude plugin details`, `codex plugin list --json`). Plugin,
  bizim `package`'ımız değildir.
- **Sürüm, yetenek değil.** Bir harness'ın alt komut desteği sürümden sürüme değişiyor; biz tek tek
  yoklama yapmıyoruz. Harness tanımı asgari sürümü `requires` ile bildirir (`opencode --version ≥ x`),
  altındaysa plan "güncelle" der ve o öğeler bloklanır. Config yolları yine `harnesses/*.yaml`'da veri
  olarak duruyor: `pi mcp list --json` ve `codex doctor` yolu verebiliyor, `claude`/`opencode` vermiyor.
- **skills.sh REST API'si kullanılmıyor.** Kurulum/kaldırma `skills` paketinin fonksiyonlarıyla
  yapılıyor; `/api/v1/*` uçlarının istediği Vercel OIDC token'ı bizim yolumuzda devrede değil.

## Bilinçli sınırlar

- `npx` yoksa hiçbir sağlayıcı çalışmaz; plan bunu ön koşul olarak söyler (Node kurulumu önerilir).
- Harness sürümü harness'ın **kendi CLI'sına** sorulur (`claude --version`); agentenv yazmaz, ama CLI
  kendi önbelleğini oluşturabilir (ör. `opencode` ilk çalıştırmada `~/.cache/opencode`, `~/.local/state`).
  `status`'un "yazmaz" garantisi agentenv'in kendi dosyaları içindir.
- Proje kapsamı bugün kapalı: iki sağlayıcı da `-g` alır, yani yalnız kullanıcı seviyesine yazar. `list`
  de envanteri yalnız kullanıcı kapsamında okur; adaptör satır başına kapsam vermediği için her satır `user`
  der. Proje kapsamı açılınca kapsam satır başına adaptörden gelir, ayrı kod yolu açılmaz.
- `list`, harness tanımlarında `agentId`si olmayan sağlayıcı ajanlarını harness'a çeviremez; onları
  sağlayıcının kendi adıyla gösterir (ör. `hermes-agent`). Bunlar agentenv'in yönetmediği harness'lardır —
  listenin kendisi de zaten yalnız agentenv'in kurduklarıyla sınırlı değildir.
- `status`/`plan` bir kurulumu yalnız sağlayıcının kendi envanteri doğruluyorsa "kurulu" sayar; `verify`
  tarifi olmayan sağlayıcıda `bilinmiyor` der ve plan öğeyi yeniden kurar.
- `update` sağlayıcının "farklı" dediğine uyar, "daha yeni" dediğine değil: `skills check` yön bildirmez,
  yalnız kayıtlı hash ile kaynağın bugünkü hâlinin farklı olduğunu söyler. Kaynak geri alınmışsa (ya da
  kurulu kopya elle değiştirilmişse) "güncelleme" eski içeriği kurar; bunu engellemek ikinci bir
  karşılaştırma yazmak olurdu, o yüzden `update` yönü bilmez.
- `update` katalog ve kayıt üzerinden çalışır: bayat skill'in katalogda bir öğesi yoksa, kayıt onu bir
  harness'a yazmamışsa ya da o harness burada tanımlı değilse kurulum yapılmaz ve satır sebebiyle raporlanır.
  Kaynak artık skill'i sunmuyorsa `stale` bunu `bayat` (silinmiş) bildirir ve `update` yine dener: kurulum
  başarısızsa o skill `hata` olur, kalanlar kurulmaya devam eder.
- `skill-lock` doğrulaması harness'e göre ayırmaz: lockfile'da hangi harness için kurulduğu yazmaz
  (`~/.agents/.skill-lock.json`, öğe başına yalnız kaynak ve skill adı). `codex` için kurulmuş bir skill
  `claude-code` için de `zaten kurulu` görünebilir; `~/.claude/skills/` ayrıca bakılmaz. Öğede `skill`
  alanı yoksa kaynak repodan herhangi bir skill'in kayıtlı olması yeter (kısmi kurulum da "var" sayılır).
  Lockfile konumu `$XDG_STATE_HOME` ile değişebilir; `verify` ve `stale` bunu okumaz.
- `stale` bizim değil sağlayıcının karşılaştırmasını raporlar: kayıtlı `skillFolderHash` ile kaynağın
  bugünkü ağaç özeti. Sınırları:
  - GitHub'ın hızlı (tree/blob) yolunda kaynak bir skill'i artık sunmuyorsa `skills check` onu hiç
    bildirmez — o satır `güncel` kalır. Silinme yalnız klon yolunda ("deleted upstream") yakalanır.
    Skill taşınmışsa aynı sessizlik geçerli.
  - Kurulu kopyadaki elle değişiklik karşılaştırılmaz; global kapsamda yalnız "disk üzerinde var mı"
    bakılır (proje kapsamındaki `computedHash` karşılaştırması devrede değil).
  - Kayıtta `skillPath`/`skillFolderHash` yoksa (hash öncesi kurulumlar, yerel kaynaklar) → `bilinmiyor`.
  - Kaynağa ulaşılamazsa `skills check` yine `✓ All global skills are up to date` basıp 0 döner; `stale`
    bu özeti değil `✗ Failed to check skills from …` satırını esas alır ve o kaynağın skill'lerini
    `bilinmiyor` yazar. Kontrol hiç bitmezse (komut yok, çökme, çıktı biçimi değişti) özet satırı
    görülmez ve hiçbir satır `güncel` olmaz — bilinmeyenin varsayılan olması bilinçli.
  - Sağlayıcı çıktısı düz metindir (`check` alt komutunun `--json`u yok); okunamayan çıktı `bilinmiyor`a
    düşer, yanlış bir `güncel`e değil.
  - `npx` kendi indirme önbelleğini yazabilir; "hiçbir şey yazmaz" garantisi agentenv'in kendi dosyaları,
    sağlayıcının lockfile'ı ve kurulu skill dizinleri içindir.
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
- Claude Code'da MCP'nin tek kaynağı `~/.claude.json` değil: `claude mcp list` ayrıca `plugin:…` girdileri
  gösteriyor. Bizim doğrulamamız **kullanıcı kapsamındaki** kayıtları okur; plugin'in getirdiği sunucular
  agentenv'in kaydı değildir.
- `agentId` alanı hem `skills` hem `add-mcp` için geçerli olmalı. Bugün örtüşüyor (`pi`, `codex`, …);
  ayrışırsa harness tanımına sağlayıcı başına kimlik gerekir.
- `add-mcp`, proje kapsamında `.mcp.json` dosyasını Claude Code ve GitHub Copilot CLI ile paylaşıyor
  (kaldırma ikisini birden etkiler). Biz yalnız global kapsam kullandığımız için bugün devrede değil.
- MCP sırları (`${VAR}` → `add-mcp --env KEY=${VAR}`) henüz uygulanmadı; öğe tanımında env alanı yok.
- `status` üç durum bilir (`güncel` / `eksik` / `bilinmiyor`); kayıtlı ama komutu değişmiş hook `eksik`
  sayılır — ayrı bir "farklı" durumu yok. Harness bölümü ayrı bir ölçek kullanır (`hazır` / `çok eski` /
  `yok`): "eski" bir algılama hatası değildir, karşılanmamış bir ön koşuldur. Sürüm okunamazsa satır
  `sürüm bilinmiyor` der ve asgari varsa `çok eski` sayılır.
- Dosya erişimi `Ctx` üzerinden enjekte edilmiyor: `plan` hedef dosyayı okuyor, testler geçici HOME ile
  bunu gerçek dosya sistemi üzerinden doğruluyor.
