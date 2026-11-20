# Launch token ghép cặp cổ phiếu: Quadra, Bankr và o1

Ngày nghiên cứu: 16/11/2026. Mục tiêu: xác định các hạng mục hữu ích để phát triển launchpad riêng của Quadra.

## Nguồn kiểm chứng và phạm vi

Với Quadra, báo cáo dựa trên mã nguồn hiện tại và việc đọc factory trên Base tại block 58.129.421. Với Bankr, nguồn là API công khai liệt kê tài sản ghép cặp trên Base và tài liệu chính thức. Với o1, nguồn là tài liệu tại `docs.o1.exchange`, cùng các bản cấu hình có ngày kiểm chứng riêng; đây là dịch vụ khác với `docs.o1bot.exchange`.

Nghiên cứu chỉ đọc dữ liệu. Không gửi lệnh launch, giao dịch, chuyển tiền, cấp quyền chi token hay triển khai contract. Chưa ký thử toàn bộ luồng của các đối thủ và chưa kiểm toán độc lập toàn bộ hệ thống của họ. Việc này không khôi phục tích hợp o1 đã lưu trữ hoặc thay đổi contract đang triển khai.

## Quadra: đã kiểm chứng trên Base

Factory v3 tại `0x006Da367654a487bb277fe25ff54f0fE0f741377` vượt qua các điều kiện kiểm tra của `checkFactory`. Hook tại `0x0D9DdcC907658E3C61318d0F979F978e600AA880` trả về mức phí mở cửa 50%, giảm trong 15 giây. Khi launch, người tạo chọn phí thông thường 1% hoặc 3%. Người tạo nhận 80% phí; bên giới thiệu được phê duyệt có thể nhận 5% từ phần của giao thức, tương ứng cách chia 80/5/15. Khi thu phí, hệ thống trả bằng token và tài sản ghép cặp đã thu được; không tự chuyển toàn bộ sang cổ phiếu ghép cặp.

Ứng dụng trả về ETH và 11 lựa chọn cổ phiếu đang bật: CRCLc, TSLAc, GOOGLc, SNDKc, MSTRc, INTCc, NVDAc, SPCXc, METAc, MSFTc và AAPLc. Đây là danh sách **hiển thị trong ứng dụng** sau khi lọc theo danh mục Coinbase, trạng thái tạm dừng chuyển token và NAV; không phải số lượng mọi mục có thể tồn tại trong registry của factory. Con số tám cổ phiếu trong các ghi chú cũ là kết quả kiểm tra ở thời điểm trước.

Nguồn mã: `src/adapters/http/launchpad.ts`, `src/config/launchpad.ts`, `src/features/panels/BaseLaunch.tsx`, `contracts/src/LaunchFactoryV3.sol`, `contracts/src/LaunchHook.sol`, cùng dữ liệu đọc trực tiếp nêu trên.

Các điểm đã có:

- Nguồn cung cố định một tỷ token; token không có quản trị viên.
- Thanh khoản một phía trên Uniswap v4 được khóa vĩnh viễn.
- Cấp quyền đúng lượng cổ phiếu trước khi thực hiện lượt mua đầu tiên ngay trong giao dịch launch.
- Kiểm tra factory và tài sản ghép cặp trước khi ký; mô phỏng các giao dịch ghi lên chuỗi.
- Card chia sẻ, giao dịch qua pool riêng và phần thể hiện ảnh hưởng của cổ phiếu ghép cặp trên trang coin.

`PoolTrade` đã có chuyển đổi ETH khi giao dịch coin ghép cặp cổ phiếu. Việc dùng ETH để mua cổ phiếu rồi launch **trong cùng một giao dịch** là tính năng riêng, hiện chưa có trong `BaseLaunch`.

## Bankr

API công khai [danh sách tài sản ghép cặp trên Base](https://api.bankr.bot/token-launches/quote-tokens?chain=base) trả HTTP 200, nhà cung cấp `doppler`, và 44 mục: 38 cổ phiếu cùng sáu tài sản khác. Có 14 mục mang cờ `illiquid: true`. Đây là cảnh báo thanh khoản, không phải bằng chứng rằng một tuyến giao dịch chắc chắn thực hiện được. Khi launch ghép cặp cổ phiếu, hệ thống dùng địa chỉ chính xác của tài sản và nhà cung cấp Doppler. Cổ phiếu có giá cũ hoặc không định giá được sẽ bị từ chối; cổ phiếu thanh khoản mỏng vẫn có thể được dùng để launch.

Theo tài liệu, tổng phí giao dịch của các đợt launch Doppler mới là 1,75%, gồm:

| Phần nhận phí | Tỷ lệ trên giá trị giao dịch |
| --- | ---: |
| Phí người tạo có thể nhận | 0,665% |
| Tái đầu tư vào thanh khoản bị khóa | 0,285% |
| Bankr | 0,475% |
| Mua lại BNKR | 0,2375% |
| Doppler | Khoảng 0,0875% |

Các tùy chọn nhận phí người tạo hoàn toàn bằng tài sản ghép cặp, mở khóa dần token cho người tạo và giới hạn số dư ví tạm thời là những thiết lập riêng. Token cũ giữ nguyên cơ chế tại thời điểm launch. Các số liệu trên áp dụng cho Doppler, không áp dụng cho hệ thống Bankr v3 riêng trên Arc. [Nguồn: tổng quan launch của Bankr](https://docs.bankr.bot/token-launching/overview/).

Bankr còn hỗ trợ ghép cặp token với một index token đáp ứng điều kiện trên Base hoặc Robinhood Chain. Tính năng này cần vault của index đang hoạt động và các bước kiểm tra điều kiện. Cấu hình Basket đã lưu trong Quadra chưa phải tài sản trên chuỗi và không thể được đưa vào pool như một ERC-20. [Nguồn: launch ghép cặp index](https://docs.bankr.bot/token-launching/index-paired-launches/).

## o1 Exchange

Các đợt launch Standard và Tax ghép cặp cổ phiếu sử dụng thanh khoản Uniswap v4 một phía, chỉ chứa token mới và được khóa vĩnh viễn. Cổ phiếu của nhà phát hành là tài sản ghép cặp; người tạo không cần nạp cổ phiếu làm thanh khoản ban đầu. Danh mục cập nhật ngày 13/11 liệt kê 341 cổ phiếu trên Base, đều có tám chữ số thập phân. Có trong danh mục không chứng minh rằng tài sản có đủ độ sâu giao dịch hoặc đang được hỗ trợ ở mọi sản phẩm. Phí bằng cổ phiếu và cổ tức của sản phẩm Tax được trả bằng cổ phiếu ghép cặp; phần đốt dùng token mới được launch. [Nguồn: launch ghép cặp cổ phiếu](https://docs.o1.exchange/launchpad/create/stock-paired-launches).

Theo tài liệu, phí Standard trên Base là 1% tính trên tài sản ghép cặp, chia 50% cho người tạo, 30% cho nền tảng và 20% cho bên giới thiệu hợp lệ. Nếu không có bên giới thiệu hợp lệ, nền tảng nhận phần đó. Phí tạo Standard trên Base là 0,001 ETH cộng phí gas. Tổng phí mở cửa giảm từ 99% xuống 1% trong 20 giây. Lượt mua đầu tiên thực hiện ngay trong giao dịch launch được miễn phần phụ phí mở cửa. Sản phẩm Tax và wstO có cơ chế khác. [Nguồn: phí và giới thiệu](https://docs.o1.exchange/launchpad/trading/fees-referrals).

Các bước xác thực, quyền hạn và giới hạn phụ thuộc của bộ chuyển đổi tuyến giao dịch quan trọng tương đương hook launch. Các hạn chế từ tổ chức phát hành cổ phiếu vẫn tồn tại độc lập với việc khóa thanh khoản. Phạm vi kiểm toán đã công bố không tự động bao phủ mọi bộ chuyển đổi. [Nguồn: bảo mật và kiểm toán](https://docs.o1.exchange/launchpad/security).

## Các hạng mục đề xuất cho Quadra

1. **Kiểm tra sức khỏe cặp trước launch.** Kết hợp trạng thái bật trong factory, quyền chuyển token từ nhà phát hành, giá NAV/DEX có thời gian cập nhật và kiểm tra tuyến mua/bán thực tế. Hiển thị rõ thanh khoản mỏng hoặc chưa đọc được dữ liệu. Tái sử dụng cơ chế lấy quote tuần tự, có giãn cách; không suy ra độ sâu chỉ từ TVL.
2. **Rà soát định giá mở cửa.** Hiển thị FDV mở cửa bằng đơn vị cổ phiếu và USD, nguồn giá tham chiếu, cùng ảnh hưởng của biến động giá cổ phiếu kể từ khi cấu hình tick mở cửa. Không tự định giá lại pool đã tồn tại hoặc tự gửi lệnh quản trị `setQuote`.
3. **Nguồn tiền và luồng xác nhận.** Cho phép dùng USDC/ETH để chi trả lượt mua đầu của cặp cổ phiếu. Có thể gộp cấp quyền và launch qua batch của ví khi được hỗ trợ. Để chuyển đổi tài sản và launch thực sự cùng thành công hoặc cùng hoàn tác, cần bộ chuyển đổi riêng đã được xác thực và rà soát contract riêng.
4. **Minh bạch phí và khoản thu bằng cổ phiếu.** Hiển thị phí đã chọn và cách chia bằng USD/đơn vị cổ phiếu; phân biệt nhận nguyên tài sản đã thu với việc chuyển đổi khoản phí sang cổ phiếu. Nhận toàn bộ phí người tạo bằng tài sản ghép cặp cần cơ chế chuyển đổi cụ thể; đổi nhãn trên giao diện không thể bổ sung hành vi này cho contract đã triển khai.
5. **Trang và nội dung hỗ trợ tăng trưởng.** Trang launch và card cần giải thích ý nghĩa của cặp cổ phiếu, liên kết đến cổ phiếu của nhà phát hành, tách lợi nhuận của coin khỏi biến động của tài sản ghép cặp, đồng thời nêu rõ phí người tạo và quy tắc giới thiệu. Ghép cặp không trao quyền sở hữu hay quyền đổi lấy cổ phiếu cho người giữ coin mới.
6. **Sản phẩm về sau: launch ghép cặp index.** Vault index, kế toán phát hành/đổi trả, định giá, tái cân bằng và kiểm tra thanh khoản tạo thành một sản phẩm contract mới. Trước mắt nên hoàn thiện Basket nằm trong ví và cấu hình rổ có thể chia sẻ; không mô tả những cấu hình này như tài sản bảo chứng cho token.

Ưu tiên 1–2 có thể cải thiện launchpad hiện tại mà chưa thay đổi cơ chế kinh tế. Nguồn tiền qua bộ chuyển đổi, chuyển đổi phí và vault index cần triển khai riêng, kiểm thử contract, rà soát bảo mật và quyết định triển khai cụ thể.
