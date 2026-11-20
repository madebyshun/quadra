# Treasury Basket: một lần xác nhận trong ví

Triển khai ngày 16/11/2026. Treasury Basket kiểm tra khả năng gộp giao dịch atomic trên Base theo [EIP-5792 v2](https://eips.ethereum.org/EIPS/eip-5792). Atomic nghĩa là các lệnh trong batch cùng thành công hoặc cùng hoàn tác.

Trạng thái `supported` bật nút mua batch. Trạng thái `ready` cũng bật nút, kèm thông báo ví có thể yêu cầu nâng cấp tài khoản. Nếu ví không trả lời, không hỗ trợ hoặc từ chối cung cấp khả năng này, người dùng vẫn có thể mua từng bước. Provider WalletConnect đang cài đã khai báo các phương thức EIP-5792 trong danh sách phương thức tùy chọn.

## Chuẩn bị và gửi giao dịch

Mỗi lần mua đều lấy quote mới cho các phần còn lại có số tiền lớn hơn không. Các yêu cầu Relay được giãn cách và thử lại theo cơ chế hiện có. Giới hạn impact 2% được kiểm tra lại; ngay trước mỗi swap luôn có lệnh cấp quyền đúng lượng USDC của phần đó. Cách sắp xếp này xử lý cả trường hợp nhiều phần dùng chung một địa chỉ nhận quyền chi token. Mỗi phần phải chứa đúng một swap cùng chuỗi đã qua kiểm tra. Phần top-up có phân bổ bằng không được bỏ qua.

Ứng dụng từ chối nếu quá trình chuẩn bị vượt 30 giây. Đây là giới hạn thời gian thận trọng của ứng dụng, không phải cam kết về thời hạn quote của Relay. Các điều kiện trượt giá, hạn giao dịch trên chuỗi và mô phỏng thực thi của ví vẫn áp dụng trong lúc người dùng xem yêu cầu.

Toàn bộ chuỗi lệnh được mô phỏng theo đúng thứ tự bằng `eth_simulateV1`, từ tài khoản đang kết nối và với số dư thực tế. Ứng dụng không thay số dư hoặc mã thực thi bằng dữ liệu giả. Nếu mô phỏng bị từ chối hoặc không đầy đủ, batch bị dừng. Tài khoản và mạng được kiểm tra lại trước khi gọi `wallet_sendCalls` với `atomicRequired: true` và mã batch duy nhất.

## Theo dõi trạng thái và tránh mua trùng

Ứng dụng lưu mã batch vào bộ nhớ cục bộ trước khi yêu cầu ví xác nhận. Batch đang chờ hoặc chưa rõ kết quả sẽ khóa thao tác mua và chỉnh sửa. Người dùng có thể kiểm tra trạng thái mà không cần ký lại, kể cả sau khi đóng/mở cửa sổ hoặc tải lại trang. Ứng dụng không tự gửi lại hoặc tự chuyển sang mua từng bước.

Khi người dùng chủ động từ chối hoặc hệ thống xác nhận batch thất bại hoàn toàn, thao tác thử lại được mở khóa. Để ghi nhận thành công, kết quả phải đúng mã batch, đúng Base, có `atomic: true` và các receipt thành công. Lượng token nhận được được cộng từ các sự kiện `Transfer` trong receipt của batch.

Khả năng khôi phục chỉ áp dụng trong cùng trình duyệt, nguồn trang và tài khoản. Giao dịch bị hoàn tác trên chuỗi vẫn có thể mất phí gas. Nâng cấp ví có thể cần thêm một lần xác nhận ban đầu.

## Kiểm chứng

- Kiểm thử đơn vị và tích hợp bao phủ việc nhận biết khả năng của ví, đổi tài khoản/mạng, từ chối ở bước mô phỏng, cấp quyền đúng lượng theo thứ tự, impact của quote mới, hết thời gian chuẩn bị, từ chối ký, các trạng thái thành công/hoàn tác/đang chờ/chưa rõ, đo lượng nhận từ receipt, lỗi bộ nhớ, nhấn đồng thời và khôi phục sau khi mở lại.
- Kiểm tra Chrome trên localhost với ví EIP-1193 mô phỏng: basket hai tài sản, một yêu cầu `wallet_sendCalls`, bốn lệnh, `atomicRequired: true`; ô nhập và nút mua bị khóa khi đang chờ; tải lại trang khôi phục đúng mã batch; xác nhận trạng thái không gửi lại giao dịch. Không có lỗi trang trong trình duyệt. Đã kiểm tra ảnh giao diện ở kích thước máy tính và điện thoại.
- Mô phỏng trực tiếp trên Base lúc 14:08:55 ngày 16/11/2026 (UTC+7), dùng [quote Relay](https://docs.relay.link/references/api/get-quote) mới đã kiểm tra: mỗi tài sản mua bằng 5 USDC, gồm NVDAc, AAPLc và WETH. Chỉ trong môi trường mô phỏng, mã của bộ thực thi được đặt tạm lên một địa chỉ công khai có tiền, rồi gọi một lần để chạy cả sáu lệnh theo cơ chế atomic. Không triển khai contract, gửi giao dịch, ký hoặc thay đổi số dư thật.

| Tài sản | Lượng quote, theo đơn vị nhỏ nhất | Mức nhận tối thiểu | Lượng nhận trong mô phỏng |
| --- | ---: | ---: | ---: |
| NVDAc, 8 chữ số thập phân | 3092197 | 3061275 | 3091817 |
| AAPLc, 8 chữ số thập phân | 1397975 | 1383995 | 1397940 |
| WETH, 18 chữ số thập phân | 2751057991484004 | 2723547411569163 | 2751012084604324 |

Kết quả này kiểm chứng khả năng ghép các lệnh Relay trong một bộ thực thi atomic. Nó không khẳng định rằng ví thật của người dùng đã ký batch; giao diện xác nhận cuối cùng phụ thuộc vào ví đó.

## Mua số tiền nhỏ để thử nghiệm — 16/11/2026

Đã bỏ ngưỡng 1 USD mỗi tài sản do ứng dụng đặt ra. Mọi tổng tiền dương biểu diễn được bằng sáu chữ số thập phân của USDC đều có thể yêu cầu quote. Nếu Relay từ chối vì số tiền hoặc tuyến giao dịch, lý do vẫn được hiển thị theo từng phần. Tổng tiền bằng không bị từ chối trước khi lấy quote.

Các kiểm thử hồi quy bao phủ basket tổng 0,50 USDC trong cả chế độ từng bước và atomic, cấp quyền chính xác với số tiền lẻ, cùng top-up 0,50 USDC. Mô phỏng atomic trực tiếp trên Base cũng thành công với 0,15 USDC NVDAc + 0,15 USDC AAPLc + 0,20 USDC WETH; từng tài sản đều nhận ít nhất mức tối thiểu trong quote. Không gửi giao dịch thật.

## Quản lý Basket và card chia sẻ — 16/11/2026

Cấu hình rổ đã lưu chỉ chứa tên và tỷ trọng mục tiêu, tối đa 20 cấu hình trong trình duyệt. Link ngắn và mã QR tái tạo rổ mục tiêu, không sao chép địa chỉ ví, số dư, số tiền mua hoặc quyền giao dịch. Dữ liệu chia sẻ được kiểm tra; ký hiệu tài sản được tra lại trong danh mục đã xác minh của ứng dụng. Mở link không tự kết nối ví, lấy quote, ký hay mua.

Bảng tài sản hiển thị tỷ trọng mục tiêu, tỷ trọng hiện tại và giá trị theo giá DEX, có thể làm mới. Nếu tài sản có số dư lớn hơn 0 nhưng không đọc được giá, việc định giá và top-up sẽ tạm không khả dụng; ứng dụng không âm thầm định giá tài sản đó bằng không. Số dư được đọc lại sau khi mua.

Strength lấy mẫu các lệnh mua toàn rổ ở mức 100 / 1.000 / 10.000 / 100.000 USD, chia đúng tỷ trọng mục tiêu và giãn cách yêu cầu quote Relay. Kết quả là cận dưới đã đo được, không phải mức tối đa chính xác hoặc ước tính từ TVL. Quote bị thiếu hoặc từ chối vẫn được ghi là chưa rõ, trừ khi Relay nêu rõ impact quá cao. Tính năng này chỉ đọc, công khai và không yêu cầu kết nối ví. Lần kiểm tra trực tiếp với rổ NVDAc/AAPLc tỷ trọng 60/40 lúc 15:11 ngày 16/11/2026 (UTC+7) đã vượt qua cả bốn mức tiền, gồm tám quote thật. Không gửi giao dịch.

Card giữ đầy đủ các tài sản mục tiêu, kể cả phần không được phân bổ tiền trong lần top-up. Card phân biệt trạng thái quote, đã mua và mua chưa đủ; ghi rõ đây là tỷ trọng mục tiêu; đồng thời bỏ câu cũ nói rằng từng phần đều được ký riêng. Có thể hiển thị tối đa mười tài sản mà không bỏ thành phần nào.

Đã xuất và kiểm tra PNG cho bố cục top-up bốn tài sản và rổ mười tài sản. Kiểm tra trình duyệt trên localhost xác nhận việc lưu và mở lại cấu hình từ link chia sẻ. Kiểm thử đơn vị/tích hợp bao phủ bộ nhớ, link sai định dạng, lỗi quote, thiếu giá để định giá số dư, card top-up, các trạng thái mua và đổi tài khoản khi giao dịch đang chờ.
