/**
 * The interface's Vietnamese copy. Parameterized entries are functions rather
 * than fragments joined in a component, so word order stays inside this file.
 *
 * Terminology follows CONTEXT.md. The register is impersonal throughout: state
 * the action or its consequence, never address the reader.
 */
import { formatNumber } from './format'

export const messages = {
  common: {
    cancel: 'Huỷ',
    confirm: 'Xác nhận',
    close: 'Đóng',
    saving: 'Đang lưu…',
    checking: 'Đang kiểm tra…',
    toBeDecided: 'TBD',
    versus: (a: string, b: string) => `${a} - ${b}`,
    awaitingQualifier: 'Chờ đội thắng',
    unknownPair: 'Đội không xác định',
    unknownPlayers: 'Không rõ người chơi',
    unknownMatch: 'Trận không xác định',
    court: (court: number) => `Sân ${formatNumber(court)}`,
    group: (group: string) => `Bảng ${group}`,
    seeds: (first: number, second: number) =>
      `Hạt giống ${formatNumber(first)} + ${formatNumber(second)}`,
    seedsUnavailable: 'Chưa có hạt giống',
  },

  rounds: {
    group: 'Vòng bảng',
    semifinal: 'Bán kết',
    final: 'Chung kết',
  },

  matchState: {
    unstarted: 'Chưa bắt đầu',
    playing: 'Đang thi đấu',
    completed: 'Đã kết thúc',
    void: 'Đã huỷ',
    walkover: 'Xử thắng',
    notPlayed: 'Chưa thi đấu',
  },

  ticket: {
    status: {
      playing: 'Đang đấu',
      completed: 'Đã xong',
      upNext: 'Sắp tới',
    },
    theFinal: 'Trận chung kết',
    upNext: 'Tiếp theo',
    order: (order: number) => `Thứ tự ${formatNumber(order)}`,
    courtLabel: (court: number) => `Sân ${formatNumber(court)}`,
    roundMatch: (round: string) => `Trận ${round.toLowerCase()}`,
    unknownPlayer: 'Không rõ tên',
  },

  organizer: {
    heading: 'Điều hành giải',
    stageBadge: (stage: string) => `Giai đoạn: ${stage}`,
    progress: (inGroups: boolean) =>
      inGroups ? 'trận vòng bảng đã đấu' : 'trận vòng loại trực tiếp đã đấu',
    unknownMatch: 'Trận không xác định',
    matchGone: 'Trận đấu này không còn nữa.',

    schedule: {
      heading: 'Sân sắp tới',
      description:
        'Thứ tự là vị trí trong hàng chờ của từng sân, nên cùng một số có thể xuất hiện một lần ở sân 1 và một lần ở sân 2. Hãy sửa tất cả rồi công bố một lần.',
      match: 'Trận',
      court: 'Sân',
      order: 'Thứ tự',
      empty: 'Không có trận nào sắp tới.',
      courtFor: (match: string) => `Sân cho ${match}`,
      orderFor: (match: string) => `Thứ tự cho ${match}`,
      review: 'Xem trước thay đổi lịch',
      confirmTitle: 'Công bố thứ tự sân mới?',
      confirmBody: 'Lịch thi đấu công khai sẽ thay đổi ngay.',
      keep: 'Giữ lịch hiện tại',
      publish: 'Công bố lịch',
      startTitle: 'Bắt đầu ghi điểm trận này?',
      startBody: 'Bắt đầu thi đấu sẽ khoá thiết lập và giao quyền ghi điểm cho thiết bị này.',
      starting: 'Đang bắt đầu…',
      start: 'Bắt đầu ghi điểm',
      startShort: 'Bắt đầu',
    },

    courts: {
      heading: 'Số sân đang dùng',
      description:
        'Thêm sân 2 sẽ giữ nguyên hàng chờ hiện tại. Giảm còn một sân sẽ dồn các trận đang chờ của sân 2 xuống cuối hàng chờ sân 1.',
      label: 'Số sân',
      review: 'Xem trước thay đổi sân',
      confirmTitle: (count: number) => `Dùng ${formatNumber(count)} sân?`,
      reduceBody:
        'Sân 2 phải không còn trận đang đấu. Các trận đang chờ sẽ chuyển xuống sau sân 1, còn các trận đã đấu xong trên sân 2 vẫn giữ nguyên lịch sử.',
      increaseBody:
        'Các trận đã xếp và thứ tự hiện tại giữ nguyên. Hãy tự chuyển những trận đang chờ sang sân 2.',
      keep: 'Giữ số sân hiện tại',
      change: 'Đổi số sân',
    },

    tie: {
      heading: (group: string) => `Đồng hạng bảng ${group}`,
      description: 'Hãy xếp thứ tự chính xác cho từng đội còn đồng hạng và ghi lại lý do.',
      moveUp: 'Lên một bậc',
      moveDown: 'Xuống một bậc',
      explanation: 'Lý do quyết định',
      review: 'Xem trước thứ tự',
      confirmTitle: (group: string) => `Ghi lại thứ tự bảng ${group}?`,
      confirmBody: 'Thứ tự này quyết định đội nào đi tiếp khi xác nhận bảng xếp hạng.',
      back: 'Xem lại thứ tự',
      record: 'Ghi lại thứ tự',
    },

    fixtures: {
      heading: 'Tạo lịch thi đấu',
      review: 'Tạo lịch thi đấu',
    },

    confirmGroups: {
      heading: 'Xác nhận bảng xếp hạng',
      description: 'Hãy xử lý các trường hợp đồng hạng, rồi chốt các đội vào bán kết.',
      review: 'Xem trước xác nhận',
      unresolved: 'Cần ghi lại thứ tự cho mọi trường hợp đồng hạng trước khi xác nhận.',
    },

    completed: {
      heading: 'Giải đã kết thúc',
      description: 'Mở lại chỉ xoá kết quả chung kết; thiết lập vẫn khoá.',
      review: 'Xem trước việc mở lại',
    },

    actions: {
      fixtures: {
        title: 'Tạo toàn bộ lịch thi đấu?',
        description: 'Thao tác này chốt lịch vòng bảng và vòng loại trực tiếp ban đầu. Hãy lưu thay đổi thiết lập trước.',
        confirm: 'Tạo lịch thi đấu',
      },
      confirmGroups: {
        title: 'Xác nhận bảng xếp hạng?',
        description: 'Hai đội đứng đầu mỗi bảng sẽ vào bán kết.',
        confirm: 'Xác nhận',
      },
      reopen: {
        title: 'Mở lại giải đấu?',
        description: 'Kết quả chung kết sẽ bị xoá để người điều hành ghi lại.',
        confirm: 'Mở lại chung kết',
      },
    },
  },

  setup: {
    heading: 'Người chơi và bảng đấu',
    description: 'Từ 4 đến 10 đội, chia đều cho bảng A và bảng B.',
    lockedTitle: 'Thiết lập đã khoá',
    lockedBody: 'Không đổi được người chơi và bảng sau khi giải bắt đầu.',
    seedAdvisoryTitle: 'Lưu ý về hạt giống',
    seedAdvisory: (count: number) =>
      `${formatNumber(count)} đội có hai người cùng hạt giống. Vẫn có thể lưu.`,
    tournamentName: 'Tên giải đấu',
    courts: 'Số sân',
    selectCourts: 'Chọn số sân',
    courtOption: (count: number) => `${formatNumber(count)} sân`,
    courtsHint: 'Hãy chọn trước khi tạo lịch thi đấu.',
    pairLegend: (index: number) => `Đội ${formatNumber(index)}`,
    removePair: (index: number) => `Xoá đội ${formatNumber(index)}`,
    teamNameLabel: (index: number) => `Tên của đội ${formatNumber(index)}`,
    teamNamePlaceholder: 'Tên đội (không bắt buộc)',
    groupFor: (index: number) => `Bảng của đội ${formatNumber(index)}`,
    playerLabel: (pair: number, player: number) =>
      `Đội ${formatNumber(pair)} người chơi ${formatNumber(player)}`,
    playerPlaceholder: (player: number) => `Người chơi ${formatNumber(player)}`,
    seedFor: (pair: number, player: number) =>
      `Hạt giống của đội ${formatNumber(pair)} người chơi ${formatNumber(player)}`,
    seedOption: (seed: number) => `Hạt giống ${formatNumber(seed)}`,
    groupsInvalid: 'Bảng A và bảng B phải bằng nhau, hoặc lệch nhau đúng một đội nếu tổng số lẻ.',
    addPair: 'Thêm đội',
    save: 'Lưu thiết lập',
    confirmTitle: 'Thay thế thiết lập và lịch thi đấu?',
    confirmBody: 'Toàn bộ thiết lập hiện tại và các trận chưa bắt đầu sẽ được tạo lại theo biểu mẫu này.',
    keepCurrent: 'Giữ thiết lập hiện tại',
    replace: 'Thay thế thiết lập',
  },

  scoring: {
    noMatch: 'Chưa có trận nào đang ghi điểm',
    backToMatches: 'Về danh sách trận',
    recovering: 'Đang khôi phục quyền ghi điểm…',
    back: 'Quay lại',
    undo: 'Hoàn tác',
    confirm: 'Kết thúc',
    savingPoint: 'Đang lưu điểm…',
    useLatestScore: 'Dùng tỉ số mới nhất',
    retry: 'Thử lại',
    takeOverScoring: 'Nhận quyền ghi điểm',
    addPoint: (pair: string) => `Cộng một điểm cho ${pair}`,
    qualifier: 'Đội thắng',
    confirmTitle: 'Kết thúc trận với tỉ số này?',
    confirmBody: (a: number, b: number) =>
      `Tỉ số ${formatNumber(a)}–${formatNumber(b)}. Đóng thông báo này nếu cần hoàn tác điểm cuối.`,
    reviewAndUndo: 'Xem lại và hoàn tác',
    confirmResult: 'Xác nhận kết quả',
    takeoverTitle: 'Nhận quyền ghi điểm trận này?',
    takeoverBody: 'Thiết bị đang ghi điểm sẽ mất quyền ngay lập tức.',
    takingOver: 'Đang nhận quyền…',
    takeOver: 'Nhận quyền',
    saveFailed: 'Không lưu được điểm.',
    tournamentReset: 'Giải đấu đã được đặt lại.',
    matchGone: 'Trận đấu này không còn ghi điểm được nữa.',
    actions: {
      takeover: 'Nhận quyền ghi điểm',
      undo: 'Hoàn tác',
      confirm: 'Kết thúc trận',
    },
    actionFailed: (action: string, reason: string) =>
      `${action} không thành công: ${reason} Tỉ số và quyền ghi điểm mới nhất đã được khôi phục; chỉ thử lại nếu vẫn cần thao tác này.`,
  },

  app: {
    fallbackTitle: 'Giải cầu lông',
    loading: 'Đang tải giải đấu…',
    unavailableTitle: 'Không tải được giải đấu',
    retry: 'Thử lại',
    setupEyebrow: 'Thiết lập giải',
    setupHeading: 'Tạo giải đấu',
    setupNote: 'Cần quyền điều hành để thiết lập lần đầu.',
    enterPinHeading: 'Nhập mã PIN điều hành để bắt đầu',
    staffAccess: 'Quyền điều hành',
    stage: {
      setup: 'Đang thiết lập',
      groups: 'Vòng bảng',
      knockouts: 'Vòng loại trực tiếp',
      completed: 'Đã kết thúc',
    },
    tabs: {
      matches: 'Trận đấu',
      standings: 'Xếp hạng',
      knockouts: 'Loại trực tiếp',
      scoring: 'Ghi điểm',
      organizer: 'Điều hành',
    },
    scoringRule: 'Chạm 21 · Cách 2 điểm · Tối đa 30',
    updating: 'Đang cập nhật…',
    liveReady: 'Đang theo dõi trực tiếp',
  },

  staff: {
    menu: 'Điều hành',
    menuLabel: 'Điều hành',
    role: {
      organizer: 'Điều hành',
      referee: 'Trọng tài',
    },
    rotateOrganizerPin: 'Đổi mã PIN điều hành',
    rotateRefereePin: 'Đổi mã PIN trọng tài',
    signOut: 'Đăng xuất',
    accessTitle: 'Quyền điều hành',
    accessDescription: 'Nhập mã PIN điều hành.',
    pinLabel: 'Mã PIN',
    continueAction: 'Tiếp tục',
    rotateTitle: {
      organizer: 'Đổi mã PIN điều hành',
      referee: 'Đổi mã PIN trọng tài',
    },
    rotateDescription: {
      organizer: 'Mọi quyền điều hành khác sẽ bị thu hồi ngay.',
      referee: 'Mọi quyền trọng tài khác sẽ bị thu hồi ngay.',
    },
    newPinLabel: 'Mã PIN mới',
    reviewRotation: 'Xem trước thay đổi',
    confirmRotateTitle: {
      organizer: 'Đổi mã PIN điều hành?',
      referee: 'Đổi mã PIN trọng tài?',
    },
    confirmRotateBody: {
      organizer: 'Các thiết bị điều hành khác sẽ mất quyền và phải nhập mã PIN mới.',
      referee: 'Các thiết bị trọng tài khác sẽ mất quyền và phải nhập mã PIN mới.',
    },
    keepPin: 'Giữ mã hiện tại',
    rotating: 'Đang đổi…',
    confirmRotate: 'Đổi mã PIN',
    rateLimited: (minutes: number) =>
      `Đã thử quá nhiều lần. Hãy thử lại sau khoảng ${formatNumber(minutes)} phút.`,
  },

  publicView: {
    awaitingConfirmationTitle: 'Chờ xác nhận bảng xếp hạng',
    awaitingConfirmationBody: 'Người điều hành cần xử lý đồng hạng và xác nhận các đội vào bán kết.',
    playingNow: 'Đang thi đấu',
    upcomingOrder: 'Thứ tự sắp tới',
    recentResults: 'Kết quả gần đây',
    versusShort: '-',
    courtPending: 'Chưa xếp sân',
    noCourtMatches: 'Chưa có trận nào được xếp sân.',
    scoreOrWalkover: (score: string | null) => score ?? 'Xử thắng',
  },

  bracket: {
    heading: 'Vòng loại trực tiếp',
    description: 'Hai đội thắng bán kết gặp nhau ở chung kết.',
    awaitingStandings: 'Chờ xác nhận bảng xếp hạng',
    active: 'Đang thi đấu',
    semifinals: 'Bán kết',
    semifinalCount: (count: number) => `${formatNumber(count)} trận`,
    finalHeading: 'Chung kết',
    finalPairs: (count: number) => `${formatNumber(count)} đội`,
    semifinalNumber: (index: number) => `Bán kết ${formatNumber(index)}`,
    courtPending: 'Chưa xếp sân',
    championLabel: 'Vô địch',
    championshipMatch: 'Trận tranh vô địch',
    winnerAdvances: 'Đội thắng vào chung kết',
  },

  standings: {
    heading: 'Bảng xếp hạng',
    description: 'Hai đội đứng đầu mỗi bảng vào vòng loại trực tiếp.',
    pair: 'Đội',
    // Abbreviated to fit a 320px table; the full term is the accessible name.
    playedShort: 'Trận',
    played: 'Số trận đã đấu',
    winsShort: 'Thắng',
    wins: 'Số trận thắng',
    differenceShort: '±',
    difference: 'Hiệu số điểm',
  },

  results: {
    heading: 'Kết quả',
    description:
      'Ghi kết quả cho trận đã đấu mà không ghi điểm trực tiếp, hoặc sửa kết quả đã ghi.',
    upcoming: 'Sắp đấu',
    completed: 'Đã kết thúc',
    noUpcoming: 'Chưa có trận nào đủ hai đội để ghi kết quả.',
    noCompleted: 'Chưa ghi kết quả nào.',
    enterResult: 'Ghi kết quả',
    correct: 'Sửa',
    correctTitle: 'Sửa kết quả',
    matchGone: 'Trận đấu này không còn nữa.',
    correctionIntro: 'Đang sửa một kết quả đã ghi. Hãy xem lại ảnh hưởng trước khi xác nhận.',
    entryIntro: 'Ghi kết quả cho trận đã đấu mà không ghi điểm trực tiếp.',
    scoreHint: 'Tỉ số hợp lệ: thắng cách 2 điểm từ 21, tối đa 30.',
    reviewCorrection: 'Xem trước thay đổi',
    reviewResult: 'Xem trước kết quả',
    confirmCorrectionTitle: 'Sửa kết quả này?',
    confirmResultTitle: 'Ghi kết quả này?',
    reviewBeforeConfirm: 'Xem lại những thay đổi trước khi xác nhận.',
    cannotApply: 'Không thể thực hiện thay đổi này.',
    confirmChange: 'Xác nhận thay đổi',
    walkoverWinner: 'Đội được xử thắng',
    recordWalkover: 'Xử thắng',
    confirmWalkoverTitle: 'Xử thắng trận này?',
    walkoverConsequence: (pair: string) =>
      `${pair} thắng mà không thi đấu. Các kết quả trước đó giữ nguyên.`,
    confirmWalkover: 'Xác nhận xử thắng',
  },

  withdrawals: {
    heading: 'Rút lui',
    description:
      'Rút lui sẽ huỷ các trận vòng bảng của đội đó và tính lại bảng xếp hạng. Hãy xem lại ảnh hưởng trước khi xác nhận.',
    review: 'Xem trước',
    withdrawn: (names: string) => `Đã rút lui: ${names}`,
    confirmTitle: (pair: string) => `Cho ${pair} rút lui?`,
    confirmTitleFallback: 'Cho đội này rút lui?',
    consequence: 'Các trận vòng bảng của đội này sẽ bị huỷ và bảng xếp hạng được tính lại.',
    cannotApply: 'Không thể cho đội này rút lui.',
    confirm: 'Xác nhận rút lui',
  },

  impact: {
    blockedHeading: 'Không thể thực hiện thay đổi này',
    score: 'Tỉ số',
    becomes: 'thành',
    affectedMatches: (count: number) => `Trận bị ảnh hưởng (${formatNumber(count)})`,
    confirmationsLost: (groups: string) => `${groups} cần được xác nhận lại.`,
    blocked: {
      'knockouts-started':
        'Vòng loại trực tiếp đã bắt đầu nên không sửa được kết quả vòng bảng, kể cả khi đội thắng không đổi. Hãy xử thắng cho trận bị ảnh hưởng.',
      'final-started': 'Trận chung kết đã phụ thuộc vào trận bán kết này nên không đổi được đội thắng.',
      'too-few-active-pairs':
        'Mỗi bảng phải còn ít nhất hai đội thi đấu. Hãy xử thắng cho những trận đội này không đấu được, thay vì cho rút lui.',
      'invalid-match-state':
        'Trạng thái trận đấu không cho phép ghi kết quả này. Trận đang ghi điểm trực tiếp cần được kết thúc trước.',
      'tournament-completed': 'Giải đấu đã kết thúc. Hãy mở lại giải trước khi sửa kết quả.',
      'decider-started':
        'Trận quyết định đã bắt đầu nên không thể sửa kết quả làm cho trận này không còn cần thiết.',
      'placement-started':
        'Trận tranh hạng đã bắt đầu nên không thể sửa kết quả làm thay đổi đội đi tiếp.',
    },
  },
} as const
