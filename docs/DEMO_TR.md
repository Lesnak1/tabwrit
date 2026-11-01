# DEMO_TR.md - Turkish voiceover companion

**Bu dosya bir prodüksiyon yardımcısıdır.** Kamuya dönük video metni ve İngilizce altyazılar [`DEMO.md`](DEMO.md) içindedir; onlar kanoniktir. Bu dosyadaki Türkçe satırlar, aynı 2:50 akışı için doğal bir voiceover sağlar.

**Kullanım:** Türkçe konuş, İngilizce altyazıları `DEMO.md`'den aynen al. Yeni bir iddia ekleme; anaakışı değiştirme. Süreler yaklaşıktır; cümleleri acele etmeden, nefes alarak oku.

---

## 0:00-0:10 - Cold open: kontrat hayır dedi

**Ekran:** terminal, büyük font.

**Türkçe VO:**
> Bu AI agent'a bir saldırgana ödeme yapması söylendi. Kontrat hayır dedi.
> Hiç para hareket etmedi, agent'ın nonce'u da tükenmedi.

**Not:** "Kontrat hayır dedi" cümlesinden sonra yarım saniye dur; ekranda kırmızı `REJECTED` görünsün.

---

## 0:10-0:22 - Ürün

**Ekran:** landing hero.

**Türkçe VO:**
> TabWrit, merchant ve AI agent'lara cap'li, süreli ve iptal edilebilir bir
> harcama Tab'ı verir. Prompt injection kontrata çarpar, cüzdanına değil.

---

## 0:22-0:38 - Vault

**Ekran:** `/app`.

**Türkçe VO:**
> Owner vault'u bir kez fonlar. Her owner işlemi kendi cüzdanında imzalanır.
> Server owner key'ini asla tutmaz.

**Not:** Cüzdan bağlantısı ve bakiye görünürken "owner key" kelimesini vurgula; ekranda anahtar görünmesin.

---

## 0:38-0:56 - Tab

**Ekran:** **Open a Tab** modal, sonra Tab kartı.

**Türkçe VO:**
> Her merchant veya agent için owner bir Tab açar: per-charge cap, dönem
> bütçesi, ömür boyu cap, son kullanma ve receiver policy. Spender'a sadece
> charge'a scoped bir Function-Call key verilir. Bu key para çekemez,
> durduramaz, iptal edemez, kuralı değiştiremez.

**Not:** Tab kartında cap, expiry ve nonce görünürken son cümleyi söyle.

---

## 0:56-1:22 - Gasless merchant ödemesi

**Ekran:** `/merchant`.

**Türkçe VO:**
> Müşteri tekrar imzalamaz. Merchant'ın scoped key'i off-chain bir NEP-366
> delegate imzalar, gas'ı relayer öder. Merchant'ın NEAR bakiyesi değişmez.
> Kontrat yine cap'leri uygular ve nonce'u tüketir.

**Not:** Receipt'te "Gas paid by relayer" satırı görünürken "NEAR bakiyesi değişmez" cümlesini söyle.

---

## 1:22-1:38 - On-chain kanıt ve 0 key

**Ekran:** `/lab`, sonra NearBlocks.

**Türkçe VO:**
> Bunlar simülasyon değil. Yirmi üç adversarial kontrol gerçek testnet
> işlemi. Final vault'ta sıfır access key var. Deployer backdoor'u yok.

**Not:** NearBlocks'ta **Access Keys: 0** görünürken "sıfır access key" cümlesini söyle.

---

## 1:38-2:02 - x402 agent API

**Ekran:** terminal, sonra `/lab` x402 kartı.

**Türkçe VO:**
> Ödeme yapılmamış bir API isteği gerçek bir HTTP 402 invoice döndürür. MCP
> tool bunu agent'ın Tab'ından öder. API, vault'un charge_executed event'ini
> doğrulamadan veri döndürmez. Replay, yanlış payer, cap üstü, yanlış receiver
> ve revoke edilmiş Tab reddedilir. On üçte on üç.

**Not:** Terminalde `X1`, `X2a`, `X7a/X7b` ve final `13/13` satırlarını göster; uzun beklemeleri kes.

---

## 2:02-2:16 - Cross-chain quote

**Ekran:** `/merchant`, **Cross-chain payout preview**.

**Türkçe VO:**
> Bu canlı bir 1Click mainnet quote'u: Base'de on USDC, gereken input ve fee
> buffer. Bu bir quote, settlement değil. Testnet demo burada biter.

**Not:** "Settlement değil" cümlesinden sonra paneldeki quote-only etiketini göster. Mainnet işlem yapılmış gibi anlatma.

---

## 2:16-2:34 - Gasless kanıt

**Ekran:** `/lab`, NEP-366 ve x402 kartları.

**Türkçe VO:**
> On iki gasless kontrol: merchant ve agent NEAR gas'ı ödemeden charge ediyor.
> Gas'ı relayer ödüyor; iki bakiye de değişmiyor. Replay, tampered signature
> ve FullAccess-key delegate reddediliyor. Keeper, prepaid credit'ler için
> sender başına gerçek gas'ı ölçüyor.

**Not:** `12/12` ve `7 relays - 0.4995 NEAR` satırları görünürken oku.

---

## 2:34-2:50 - Kapanış

**Ekran:** landing final section.

**Türkçe VO:**
> TabWrit. Every Tab has a Writ. NEAR HACKATHON 2026'da geliştirildi. Repo ve
> canlı testnet demo aşağıda. Sadece testnet. 1Click bir quote, settlement
> değil.

**Not:** Repo URL hazır: `https://github.com/Lesnak1/tabwrit`. `https://tabwrit.vercel.app` yer tutucusunu canlı Vercel URL'siyle değiştirmeden videoyu export etme; URL yoksa kapanışı sonra kaydet veya edit'te ekle.

---

## Kayıt notları

- Türkçe konuşurken İngilizce altyazıların `DEMO.md`'deki metinle aynı olduğundan emin ol.
- Teknik terimleri (Tab, TabWrit, NEP-366, x402, tUSDC, `charge_executed`, `RECEIVER_NOT_ALLOWED`) olduğu gibi kullan.
- Cümleleri 10-15 saniyelik parçalar halinde kaydet; hataları kes.
- Voiceover'ı ekran kaydından ayrı kaydet; arka plan müziğini sonra ekle.
- Videoda `.env`, private key, seed phrase veya kişisel bildirim gösterme.
- Mainnet settlement yapılmadı; videoda öyle bir iddia yok.
