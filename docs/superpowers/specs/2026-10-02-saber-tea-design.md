# Saber-Tea — Thiết kế

Ngày: 2026-10-02
Trạng thái: đã duyệt, chờ lập kế hoạch thực thi

## 1. Game là gì

Game nhịp điệu chạy trên trình duyệt, lấy cảm hứng từ Beat Saber. Người chơi
dùng **hai bàn tay thật trước webcam** để chém các khối bay tới theo nhạc. Khối
là **logo lá trà của CLB**.

Không có VR, không có tay cầm. Chỉ cần trình duyệt và webcam.

### Cơ chế ship bản đầu

| Cơ chế | Có | Ghi chú |
|---|---|---|
| Chém đúng màu (2 tay) | ✅ | Lõi |
| Chém đúng hướng (mũi tên) | ✅ | Dung sai ±50° |
| Fallback chuột / cảm ứng | ✅ | Bắt buộc vì web public |
| Né tường (cúi/nghiêng) | ❌ | Cần Pose Landmarker, không chơi được khi ngồi bàn |

Bỏ né tường kéo theo **bỏ hẳn model thứ hai** — chỉ còn Hand Landmarker.

## 2. Bối cảnh & ràng buộc

- **Web public.** Ai cũng mở được bằng URL, trên laptop hoặc điện thoại.
- Phải chịu được: webcam kém, ánh sáng xấu, người dùng từ chối quyền camera,
  Safari/iOS.
- **`getUserMedia` chỉ chạy trên HTTPS hoặc `localhost`.** Ràng buộc cứng, quyết
  định luôn cách deploy.
- Không backend, không tài khoản, không database.

## 3. Ba quyết định kỹ thuật cốt lõi

### 3.1 Trục Z chỉ là đồng hồ, không phải không gian thật

Khối sinh ra lúc `t`, phải bị chém lúc `t + 2s`. MediaPipe trả toạ độ tay **2D**
(x, y chuẩn hoá 0–1). Nên va chạm thực chất là bài toán **2D + thời gian**.
Không có phép tính 3D thật nào xảy ra trong game này.

Hệ quả: **render bằng Canvas 2D với phối cảnh giả** (scale theo thời gian còn
lại, dịch về điểm tụ). Logo là sprite phẳng nên render 3D thật cũng ra hình gần
y hệt, mà lại phải thêm một lớp chiếu toạ độ tay 2D vào không gian 3D — thêm chỗ
sai, không thêm gì về hình ảnh.

Đã cân nhắc và loại: Three.js (+~170KB, lợi ích chỉ là bloom đẹp hơn),
CSS 3D transforms (30–60 div cùng lúc sẽ ì, không vẽ được particle).

### 3.2 Mọi thứ chạy theo `audio.currentTime`

Vị trí mỗi khối là **hàm thuần của `audio.currentTime`**, không bao giờ cộng dồn
delta của `requestAnimationFrame`.

Đây là chỗ mọi game nhịp điệu chết: rAF tụt frame → khối lệch nhạc dần và không
bao giờ bắt lại được. Lấy mốc từ chính thẻ audio thì tụt frame chỉ làm giật
hình, không làm lệch nhịp.

### 3.3 Lật gương toạ độ, nhưng không lật nhãn tay

> **Đính chính so với bản nháp đầu.** Bản nháp ghi "phải đảo nhãn tay". Sai.
> Đã kiểm chứng bằng ảnh test của MediaPipe và kết quả ngược lại.

Hai thứ nghe giống nhau nhưng tách rời:

**Toạ độ: phải lật.** `x_screen = 1 - x_landmark`. Người chơi vơ tay sang phải
thì kiếm trên màn hình phải chạy sang phải, như soi gương.

**Nhãn `"Left"`/`"Right"`: KHÔNG đảo.** Nhãn suy ra từ **hình dạng** bàn tay
trong khung hình, không phải vị trí. Feed webcam thô cho ra đúng tay thật.

Bằng chứng — chạy detector trên ảnh test `woman_hands.jpg`:

| Ảnh | Kết quả |
|---|---|
| Gốc (chưa lật) | `Left@x=0.068`, `Right@x=0.726` — khớp ground truth |
| Lật gương | `Left@x=0.274`, `Right@x=0.93` — nhãn đổi chỗ |

Bẫy thật nằm ở điều kiện: **nếu lật chính khung hình trước khi đưa vào detector
thì phải đảo nhãn lại.** Ta chỉ lật toạ độ đầu ra, không bao giờ lật pixel đầu
vào — nên không đảo. Ghi comment thẳng vào `tracker.js`.

## 4. Kiến trúc production

### 4.1 Hình dạng hệ thống

**Static site thuần. Không backend. Không build step.**

```
Trình duyệt người chơi
├── index.html  ──┐
├── tracker.js    │  ES modules, serve nguyên trạng
├── beatmap.js    │  <script type="module">
├── game.js     ──┘
├── assets/Icon Transparent.png
│
├── CDN jsDelivr ──→ @mediapipe/tasks-vision (JS + WASM, phiên bản ghim cứng)
├── CDN Google  ──→ hand_landmarker.task (~7.5MB, cache sau lần đầu)
└── File nhạc  ──→ do người chơi chọn từ máy, KHÔNG rời khỏi máy
```

Không webpack/vite/bundler. ES modules native đủ dùng, và bỏ build step nghĩa là
deploy chỉ là push code.

### 4.2 Hosting

**GitHub Pages, deploy from branch `main`, thư mục gốc.**

- Repo đã ở GitHub → Pages miễn phí
- **HTTPS tự động** → thoả ràng buộc `getUserMedia`
- Zero config: bật trong Settings → Pages, không cần file workflow
- Deploy = `git push`

### 4.3 Nhạc: người chơi tự chọn file

`<input type="file" accept="audio/*">` → `decodeAudioData`.

Giải quyết luôn ba thứ cùng lúc: không tốn băng thông host nhạc, **không vướng
bản quyền**, và file nhạc không bao giờ rời khỏi máy người chơi. Kèm một bài
demo ngắn trong repo để ai vào cũng bấm chơi được ngay, không phải đi tìm file.

### 4.4 Lưu trữ

`localStorage` cho điểm cao. Hết. Không server, không tài khoản, không
leaderboard.

### 4.5 Hiệu năng

- Hand Landmarker chạy ~30fps, render chạy rAF 60fps, **dùng kết quả landmark
  mới nhất, không nội suy**
- Model ~7.5MB tải từ CDN Google, trình duyệt cache sau lần đầu
- Màn hình loading có thanh tiến độ ở lần đầu vào

## 5. Thiết kế chi tiết

### 5.1 File

| File | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `index.html` | canvas, `<video>` ẩn, UI (chọn nhạc, điểm, loading) | — |
| `tracker.js` | MediaPipe Hands → vị trí 2 tay; fallback chuột | tasks-vision |
| `beatmap.js` | PCM → danh sách khối. **Hàm thuần, test được bằng node** | không |
| `game.js` | vòng lặp, va chạm, vẽ, điểm | tracker, beatmap |
| `package.json` | chỉ chứa `{"type":"module"}` | — |

`package.json` tồn tại vì **một lý do duy nhất**: để `node beatmap.js` hiểu được
cú pháp `export`. Không có dependency, không có script, không có bước cài đặt.

`beatmap.js` không được import gì từ Web Audio — nó nhận `Float32Array` và trả
mảng khối. Giải mã audio nằm ở `game.js`. Ranh giới này là thứ làm cho nó test
được bằng `node`.

### 5.2 Điểm theo dõi trên bàn tay

- **Landmark 8 (đầu ngón trỏ)** = mũi kiếm → dùng cho va chạm và vận tốc
- **Landmark 0 (cổ tay)** = chuôi kiếm → vector cổ tay→ngón trỏ cho hướng vẽ lưỡi kiếm

Hai điểm này về cùng một lần gọi API, không tốn thêm gì.

### 5.3 Onset detection — không cần FFT

```
1. PCM → mono
2. Lowpass một cực (nhấn tiếng kick drum)
3. RMS theo khung 1024 mẫu, hop 512  (~86 khung/giây ở 44.1kHz)
4. Đánh dấu onset khi CẢ BA điều kiện đúng:
     - năng lượng > 1.3 × trung bình trượt 0.5s
     - là cực đại cục bộ
     - cách onset trước ≥ 120ms
```

Khoảng 40 dòng, không thư viện DSP. Lowpass thay cho FFT: đủ để bắt kick, mà rẻ
hơn nhiều.

Ngưỡng `1.3` và `120ms` là **núm chỉnh**, để lộ ra thành hằng số có tên. Nhạc
thật không giống nhạc lý tưởng — sẽ phải tinh chỉnh bằng tai.

### 5.4 Onset → khối

Luân phiên tay trái/phải. Lane lệch về phía tay đó. Hướng mũi tên xoay dần từ
hướng trước (tránh chuỗi hướng ngẫu nhiên vô nghĩa).

**Chặn cứng: cùng một tay cách nhau tối thiểu 200ms**, không thoả thì bỏ onset
đó. Người thật không chém kịp nhanh hơn thế.

Lưới 4 cột × 3 hàng, như Beat Saber gốc.

### 5.5 Vòng lặp một frame

```
landmarks ← tracker (kết quả mới nhất)
t ← audio.currentTime

với mỗi khối còn sống:
    tiến độ = (t - khối.time + 2.0) / 2.0        # bay 2 giây
    scale, vị trí ← phối cảnh(tiến độ, lane, row)

    nếu |t - khối.time| < 0.15:                  # cửa sổ chém
        nếu đầu ngón trỏ gần khối
           và tốc độ ngón tay > ngưỡng
           và góc(vận tốc, hướng yêu cầu) < 50°:
               ăn điểm, nổ particle, xoá khối

    nếu t > khối.time + 0.15:  tính miss, xoá khối

vẽ
```

Vận tốc ngón tay lấy từ 3 frame gần nhất (ở 30fps, một cú chém kéo dài khoảng
4–6 frame).

**Dung sai góc 50°** — rộng có chủ đích. Webcam nhiễu; siết chặt hơn thì không
ai chém trúng và game thành bực mình. Đây cũng là núm chỉnh.

### 5.6 Màu

Logo vốn xanh lá. Quy ước:

- **Tay trái** = lá nhuộm đỏ hồng
- **Tay phải** = lá xanh gốc

Để thành hằng số ở đầu `game.js`, đổi trong 10 giây nếu CLB muốn khác.

### 5.7 Fallback

Chuyển sang chuột/cảm ứng khi: không cấp quyền camera, hoặc **3 giây liên tục
không phát hiện bàn tay nào**.

Chế độ fallback: một kiếm, chém được cả hai màu. Có nút bật lại chế độ tay.

Trên web public đây không phải tính năng phụ — thiếu nó thì một phần lớn người
vào chỉ thấy màn hình đen.

## 6. Kiểm thử

`detectOnsets(pcm, sampleRate)` là hàm thuần → một self-check chạy được:

```bash
node beatmap.js
```

Dựng click track nhân tạo (xung mỗi 0.5s), assert số onset đúng và sai lệch
< 30ms. Không framework, không fixture.

Phần còn lại (tracking, render) kiểm bằng mắt theo từng phase — viết test cho
webcam và canvas tốn nhiều hơn giá trị nó mang lại ở quy mô này.

## 7. Chia nhỏ công việc

**Quy tắc: mỗi phase code xong → cập nhật `CLAUDE.md` → commit → push.**

Không dồn toàn bộ game vào một lượt. Mỗi phase phải tự chạy được và tự kiểm
chứng được trước khi sang phase sau.

| Phase | Nội dung | Cách kiểm chứng |
|---|---|---|
| **0** | `index.html` + canvas vẽ một hình. Bật GitHub Pages. | Mở URL Pages thấy hình |
| **1** | `tracker.js`: MediaPipe Hands, chấm điểm lên đầu ngón trỏ trên video lật gương | Vơ tay, chấm bám theo; nhãn trái/phải đúng |
| **2** | `beatmap.js`: `detectOnsets` + `onsetsToBlocks` + self-check | `node beatmap.js` assert pass |
| **3** | `game.js`: chọn file nhạc + bài demo kèm repo, khối bay ra đúng nhịp. Chưa va chạm. | Nhìn/nghe thấy khối khớp nhạc |
| **4** | Va chạm + hướng + điểm + combo | Chém trúng ăn điểm; chém sai hướng thì trượt |
| **5** | Fallback chuột, particle, glow, UI, điểm cao localStorage | Tắt camera vẫn chơi được |

Phase 0 đứng đầu có lý do: chứng minh đường deploy thông **trước khi** viết logic
game, tránh cảnh "chạy ngon ở máy, chết trên Pages" lúc đã viết xong hết.

### Quy ước commit

Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`.
Mỗi phase ít nhất một commit, push ngay sau commit.

### `CLAUDE.md` giữ gì

Để phiên làm việc sau không phải dò lại từ đầu:

- Game là gì, chơi thế nào
- Bản đồ file + trách nhiệm từng file
- **Ba cái bẫy ở mục 3** (timing theo `audio.currentTime`, lật gương, đảo nhãn tay)
- Cách chạy local, cách chạy test
- Phase đang ở đâu

## 8. Cố tình không làm

| Bỏ | Thêm lại khi |
|---|---|
| Tường / né người | Có người chơi đứng xa webcam thật sự |
| Leaderboard server | Có người hỏi "điểm tôi đứng thứ mấy" |
| Nhiều mức độ khó | Bản một-độ-khó đã được chơi đủ nhiều |
| Thư viện nhạc online | Chọn file từ máy tỏ ra bất tiện |
| Tài khoản người dùng | Không bao giờ, trừ khi có lý do rõ ràng |
| Service worker / offline | Có người thật phàn nàn về tải lại |
| Build step (vite/webpack) | ES modules native tỏ ra không đủ |
