# Saber-Tea

Game nhịp điệu chạy trên trình duyệt, kiểu Beat Saber nhưng **không cần VR**.
Người chơi dùng hai bàn tay thật trước webcam để chém các khối bay tới theo
nhạc. Khối là logo lá trà của CLB.

Thiết kế đầy đủ: [`docs/superpowers/specs/2026-10-02-saber-tea-design.md`](docs/superpowers/specs/2026-10-02-saber-tea-design.md)

## Chạy

```bash
python3 -m http.server 8080
```

Mở http://localhost:8080

Không có build step. ES modules native, serve nguyên trạng.
`getUserMedia` chỉ chạy trên `localhost` hoặc HTTPS — mở bằng `file://` sẽ
không có webcam.

## Test

```bash
node beatmap.js
```

Chỉ `beatmap.js` có test (logic thuần). Tracking và render kiểm bằng mắt.

Lúc đang chơi có `window.saberTea` để kiểm từ console: `songTime`, `cursor`,
`blocks`, `playing`. Lỗi lệch nhịp không nhìn thấy được trong ảnh chụp màn hình,
phải đo bằng số.

**Đo bên trong `requestAnimationFrame` callback**, đừng đo bằng `setTimeout`.
`songTime` đọc đồng hồ audio tươi, còn `cursor` chỉ cập nhật mỗi frame — đo lệch
pha sẽ báo sai hàng loạt. (Đã dính một lần: 16/21 "vi phạm" hoá ra là lỗi phép đo,
đo lại trong rAF thì 180/180 sạch.)

## File

| File | Trách nhiệm |
|---|---|
| `index.html` | canvas, `<video>` ẩn, UI |
| `game.js` | vòng lặp, va chạm, vẽ, điểm |
| `tracker.js` | MediaPipe Hands → vị trí 2 tay; fallback chuột |
| `beatmap.js` | PCM → danh sách khối. **Hàm thuần, không import Web Audio** |
| `package.json` | chỉ để `node` hiểu `export`. Không dependency. |

## Ba cái bẫy — đọc trước khi sửa code

**1. Thời gian lấy từ `audio.currentTime`, không bao giờ cộng dồn delta rAF.**
Vị trí khối là hàm thuần của `audio.currentTime`. Cộng dồn delta thì khi tụt
frame, khối lệch nhạc dần và không bao giờ bắt lại được. Đây là chỗ mọi game
nhịp điệu chết.

**2. Video phải lật gương: `x_screen = 1 - x_landmark`.**
Không lật thì người chơi vơ tay sang phải, hình chạy sang trái.

**3. KHÔNG đảo nhãn `"Left"`/`"Right"` của MediaPipe — nhưng chỉ khi feed ảnh thô.**
Nhãn được suy ra từ **hình dạng** bàn tay trong khung hình, không phải từ vị trí.
Nên feed webcam thô cho ra đúng tay thật của người chơi.

Đã kiểm chứng bằng ảnh test của MediaPipe: lật gương ảnh thì nhãn đổi chỗ
(`Right@x=0.726` thành `Left@x=0.274`). Chính vì vậy ảnh **chưa** lật mới đúng.

Bẫy nằm ở chỗ: nếu sau này ai đó lật chính khung hình trước khi đưa vào
detector thì **phải** đảo nhãn lại. Hiện tại ta chỉ lật **toạ độ đầu ra**
(bẫy số 2), không bao giờ lật pixel đầu vào. Giữ nguyên như vậy.

## Hai hệ toạ độ — đừng trộn

Landmark bàn tay chuẩn hoá theo **khung camera**. Toạ độ con trỏ chuẩn hoá theo
**cửa sổ trình duyệt**. Hai phép biến đổi khác nhau thật sự, `layout()` trong
`game.js` chọn cái nào theo `status.input`. Video giữ phép biến đổi riêng của nó
(`videoLayout()`, cover-fit), nên trong chế độ chuột vẫn vẽ được video nền mà
kiếm vẫn đúng chỗ chuột.

Vận tốc cũng phải đổi sang **screen space** trước khi so với mũi tên
(`vel.x * L.dw`, `vel.y * L.dh`). Để nguyên toạ độ chuẩn hoá thì mọi đường chéo
bị méo theo tỉ lệ khung hình.

## Chế độ chuột

Một con trỏ lái **cả hai** kiếm cùng lúc — nên khối màu nào cũng chém được mà
`checkHits()` không cần một dòng đặc biệt nào. Tự chuyển sang chuột khi camera
hỏng hoặc 3 giây không thấy tay. Nút góc dưới phải để quay lại tay; nút đó ẩn
khi không có camera, vì lúc đó không có gì để quay lại.

## Sổ sách điểm — bất biến đúng

Không phải `hits + misses === cursor`. Khối chém **sớm** (trong nửa cửa sổ trước
`block.time`) cộng `hits` ngay nhưng `cursor` chưa đi qua nó. Bất biến đúng:

```
hits + misses === cursor + (số khối đã chém mà cửa sổ chưa đóng)
```

Chỉ khi mọi cửa sổ đóng hết thì `hits + misses === cursor` mới chính xác.

## Hằng số hay phải chỉnh

Nhạc thật không giống nhạc lý tưởng, webcam thật không giống webcam lý tưởng.
Mấy con số này sinh ra để chỉnh bằng tai và bằng tay:

| Hằng số | Mặc định | Ở đâu |
|---|---|---|
| Ngưỡng onset | `1.3×` trung bình trượt | `beatmap.js` |
| Khoảng cách onset tối thiểu | `120ms` | `beatmap.js` |
| Cùng tay cách nhau tối thiểu | `200ms` | `beatmap.js` |
| Thời gian khối bay | `2.0s` | `game.js` |
| Cửa sổ chém | `±0.15s` | `game.js` |
| Dung sai hướng chém | `50°` | `game.js` |

## Tiến độ

- [x] **Phase 0** — canvas + deploy GitHub Pages
- [x] **Phase 1** — `tracker.js`, MediaPipe Hands
- [x] **Phase 2** — `beatmap.js`, onset detection + self-check
- [x] **Phase 3** — khối bay đúng nhạc
- [x] **Phase 4** — va chạm + hướng + điểm
- [x] **Phase 5** — fallback chuột, particle, UI

Quy ước: mỗi phase xong thì cập nhật file này, commit, push.
Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
