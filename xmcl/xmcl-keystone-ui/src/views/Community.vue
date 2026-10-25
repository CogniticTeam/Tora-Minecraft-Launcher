<template>
  <div data-testid="community-page" class="community-page">
    <header class="community-header">
      <div class="community-heading"><v-icon color="primary" :size="24" aria-hidden="true">forum</v-icon><h1>社区</h1></div>
      <div class="community-header-actions">
        <v-btn icon variant="text" size="small" aria-label="通知中心" @click="openView('notifications')"><v-badge :model-value="unread > 0" dot color="primary"><v-icon :size="21">notifications_none</v-icon></v-badge></v-btn>
        <v-menu location="bottom end"><template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" variant="text" class="my-community" append-icon="expand_more">我的社区</v-btn></template><v-list density="compact" min-width="180"><v-list-item prepend-icon="edit_note" title="我的帖子" @click="openView('me')" /><v-list-item prepend-icon="bookmark_border" title="我的收藏" @click="openView('me', { tab: 'saved' })" /><v-list-item prepend-icon="notifications_none" title="通知中心" @click="openView('notifications')" /><v-list-item v-if="isStaff" prepend-icon="shield" title="社区管理" @click="openView('moderation')" /></v-list></v-menu>
        <v-btn v-if="!isEditor" data-testid="community-new-post" color="primary" variant="flat" prepend-icon="add" :disabled="!ready" @click="beginPost">发布帖子</v-btn>
      </div>
    </header>
    <div ref="scrollRoot" class="community-content">
      <Transition name="fade-transition" mode="out-in"><div :key="communityViewKey" class="community-view" :class="{ 'community-view--editor': isEditor }">
      <div v-if="identityError" class="c-inline-warning">{{ identityError }}<v-btn @click="reconnect" :ripple="true" variant="text" type="button">重试社区身份</v-btn></div>
      <div v-if="!infoLoading && !ready" class="c-inline-warning">{{ connected ? '社区正在维护，暂时不能发布内容。' : '社区暂时无法连接，请稍后重试。' }}<v-btn @click="refreshInfo" :ripple="true" variant="text" type="button">重新连接</v-btn></div>
      <template v-if="page === 'list'">
        <div class="community-filter-bar"><v-menu location="bottom start" max-height="520"><template #activator="{ props: categoryProps }"><v-btn v-bind="categoryProps" class="community-category-button" variant="text" prepend-icon="filter_list" append-icon="expand_more">{{ category === 'all' ? '全部分类' : communityKinds[category as CommunityKind] }}</v-btn></template><v-list density="compact" min-width="220" aria-label="论坛分类"><v-list-item title="全部分类" :active="category === 'all'" :prepend-icon="category === 'all' ? 'check' : undefined" @click="category = 'all'" /><template v-for="group in communityGroups" :key="group.title"><v-list-subheader>{{ group.title }}</v-list-subheader><v-list-item v-for="item in group.items" :key="item.value" :active="category === item.value" :title="item.title + (categoryCounts[item.value] ? ` (${categoryCounts[item.value]})` : '')" :prepend-icon="category === item.value ? 'check' : undefined" @click="category = item.value" /></template></v-list></v-menu><span class="c-muted">{{ categoryGroupTitle }}</span><v-btn v-if="category !== 'all'" size="small" variant="text" icon="close" aria-label="清除分类筛选" @click="category = 'all'" /></div>
        <div class="community-grid"><section class="community-feed" aria-label="帖子列表">
          <div class="c-toolbar"><v-text-field v-model="search" type="search" maxlength="80" aria-label="搜索帖子标题" placeholder="搜索帖子" prepend-inner-icon="search" variant="outlined" density="compact" hide-details clearable @click:clear="search = ''" /><v-select v-model="sort" :items="[{ title: '最新发布', value: 'latest' }, { title: '最近回复', value: 'reply' }]" aria-label="帖子排序" variant="outlined" density="compact" hide-details class="community-sort" /></div>
          <div class="c-feed-hint"><span>{{ posts.length ? `讨论 · ${posts.length}` : '讨论' }}</span></div>
          <div v-if="listLoading && !posts.length" class="c-skeleton" role="status" aria-label="正在加载讨论"><div v-for="i in 3" :key="i" /></div>
          <div v-else-if="listError" class="c-empty"><v-icon :size="28">cloud_off</v-icon><h2>暂时无法加载讨论</h2><p>{{ listError }}</p><v-btn class="c-button" @click="loadPosts()" :ripple="true" color="primary" variant="tonal" type="button">重新加载</v-btn></div>
          <CommunityPostRows v-else-if="posts.length" :posts="posts" @open="openPost" />
          <div v-else class="c-empty"><v-icon class="c-empty-icon" :size="48">forum</v-icon><h2>{{ hasFilters ? '没有匹配的帖子' : '暂无讨论' }}</h2><p>{{ hasFilters ? '换个关键词，或清除筛选后再试。' : '在这里交流玩法、寻求帮助，分享教程和整合包。' }}</p><v-btn class="c-button" :disabled="!ready" @click="hasFilters ? clearFilters() : beginPost()" :ripple="true" color="primary" variant="tonal" type="button">{{ hasFilters ? '清除筛选' : '发布帖子' }}</v-btn></div>
          <div v-if="listCursor" class="c-load-more"><v-btn class="c-button" :disabled="listLoading" @click="loadPosts(true)" :ripple="true" color="primary" variant="tonal" type="button">{{ listLoading ? '正在加载…' : '加载更多讨论' }}</v-btn></div>

        </section></div>
      </template>
      <template v-else>
        <v-btn class="c-back" @click="openView('list')" :ripple="true" variant="text" size="small" type="button"><v-icon :size="16">arrow_back</v-icon>返回讨论</v-btn>
        <div v-if="pageLoading" class="c-empty" role="status">正在加载…</div>
        <div v-else-if="viewError" class="c-empty"><h2>暂时无法打开内容</h2><p>{{ viewError }}</p><v-btn class="c-button" @click="loadPage" :ripple="true" color="primary" variant="tonal" type="button">重新加载</v-btn></div>
        <template v-else-if="page === 'post' && post">
          <div class="community-reading"><div>
            <article class="c-article"><div class="c-tags"><span class="c-tag">{{ communityKinds[post.type] }}</span><span v-if="post.accepted_comment_id" class="c-tag solved">已解决</span><span v-if="post.status !== 'published'" class="c-tag">{{ post.status === 'pending' ? '系统审核中 · 仅作者和版主可见' : '已隐藏 · 仅作者和版主可见' }}</span><span v-if="post.locked" class="c-tag">已锁定</span><span v-if="post.version" class="c-tag">{{ post.version }}</span><span class="c-tag">{{ post.loader }}</span></div><h2>{{ post.title }}</h2><div class="c-author"><span class="c-avatar">{{ post.author.nickname.slice(0, 1) }}</span><div><strong>{{ post.author.nickname }}</strong><span v-if="post.author.role !== 'member'" class="c-role">版主</span><small>{{ communityTime(post.created_at) }}{{ post.revision > 1 ? ' · 已编辑' : '' }}</small></div></div>
              <CommunityMarkdown :text="post.body || ''" @link="showExternal" @notice="notify" />
              <div v-if="post.source_url" class="c-source"><strong>资源来源 · {{ sourceHost(post.source_url) }}</strong><p>原作者：{{ post.original_author }}</p><v-btn class="c-button small" @click="showExternal(post.source_url)" :ripple="true" color="primary" variant="tonal" size="small" type="button">查看来源<v-icon :size="14">open_in_new</v-icon></v-btn><v-btn v-if="post.status === 'published' && isModrinthResource(post.source_url)" color="primary" variant="tonal" size="small" prepend-icon="download" @click="resourceImportShown = true">导入启动器</v-btn><small>先核实来源与适用版本，导入前可查看文件清单。</small></div>
              <div class="c-article-actions"><v-btn class="c-button small" :class="{ selected: post.liked }" :active="post.liked" :aria-pressed="post.liked" :disabled="busy || post.status !== 'published'" @click="interact('like')" :ripple="true" color="primary" variant="tonal" size="small" type="button"><v-icon :size="16">favorite_border</v-icon>{{ post.liked ? '已赞' : '有帮助' }} · {{ post.likes }}</v-btn><v-btn class="c-button small" :class="{ selected: post.bookmarked }" :active="post.bookmarked" :aria-pressed="post.bookmarked" :disabled="busy || post.status !== 'published'" @click="interact('bookmark')" :ripple="true" color="primary" variant="tonal" size="small" type="button"><v-icon :size="16">bookmark_border</v-icon>{{ post.bookmarked ? '已收藏' : '收藏' }}</v-btn><v-btn v-if="post.mine && post.status !== 'hidden' && !post.locked" class="c-button small" @click="openView('edit', { id: post.id })" :ripple="true" color="primary" variant="tonal" size="small" type="button">编辑</v-btn><v-btn v-if="post.status === 'published'" class="c-button small quiet c-report" @click="openReport('post', post.id)" :ripple="true" color="primary" variant="text" size="small" type="button"><v-icon :size="16">outlined_flag</v-icon>举报</v-btn></div>
              <div v-if="isStaff" class="c-admin-actions"><small>版主操作</small><v-btn v-if="post.status !== 'hidden'" class="c-button small" @click="openModeration('hide', 'post', post.id, post.revision)" :ripple="true" color="primary" variant="tonal" size="small" type="button">隐藏帖子</v-btn><v-btn v-if="post.status === 'published'" class="c-button small" @click="openModeration(post.locked ? 'unlock' : 'lock', 'post', post.id, post.revision)" :ripple="true" color="primary" variant="tonal" size="small" type="button">{{ post.locked ? '解锁帖子' : '锁定帖子' }}</v-btn></div>
            </article>
            <section class="c-replies" aria-label="帖子回复"><div class="c-section-heading"><h3>回复 · {{ post.comments }}</h3><small>按时间排序</small></div><article v-for="comment in comments" :id="comment.id" :key="comment.id" class="c-reply" :class="{ accepted: post.accepted_comment_id === comment.id, nested: comment.parent_id }"><span class="c-avatar">{{ comment.author_name.slice(0, 1) }}</span><div class="c-reply-copy"><div class="c-reply-author">{{ comment.author_name }}<span v-if="post.accepted_comment_id === comment.id" class="c-tag solved">已被采纳</span></div><p>{{ comment.body }}</p><div class="c-reply-meta"><time>{{ communityTime(comment.created_at) }}</time><v-btn v-if="comment.status === 'published' && !post.locked" @click="setReply(comment)" :ripple="true" variant="text" type="button">回复</v-btn><v-btn v-if="post.mine && post.type === 'help' && !comment.mine && comment.status === 'published'" :disabled="busy" @click="acceptAnswer(comment)" :ripple="true" variant="text" type="button">{{ post.accepted_comment_id === comment.id ? '撤销采纳' : '采纳此回复' }}</v-btn><v-btn v-if="comment.mine && comment.status === 'published' && post.status === 'published' && !post.locked" @click="editComment(comment)" :ripple="true" variant="text" type="button">编辑回复</v-btn><v-btn v-if="comment.status === 'published'" @click="openReport('comment', comment.id)" :ripple="true" variant="text" type="button">举报</v-btn><v-btn v-if="isStaff && comment.status !== 'hidden'" @click="openModeration('hide', 'comment', comment.id, comment.revision)" :ripple="true" variant="text" type="button">隐藏</v-btn></div></div></article>
              <v-btn v-if="commentsCursor" class="c-button small" :disabled="busy" @click="runLoad(() => loadComments(true))" :ripple="true" color="primary" variant="tonal" size="small" type="button">加载更多回复</v-btn>
              <p v-if="post.locked || post.status !== 'published'" class="c-muted">{{ post.locked ? '帖子已锁定，暂时不能回复。' : '内容尚未公开，暂时不能回复。' }}</p>
              <form v-else class="c-reply-form" @submit.prevent="submitReply"><div v-if="replyTarget" class="c-reply-target">回复 {{ replyTarget.author_name }}<v-btn type="button" @click="replyTarget = undefined" :ripple="true" variant="text">取消</v-btn></div><div class="community-native-field"><v-textarea ref="replyInput" v-model="replyBody" data-testid="community-reply-input" maxlength="2000" rows="3" required placeholder="友善交流，让每一份经验都能帮到别人。"  label="写下你的经验" variant="outlined" hide-details="auto" /></div><div class="c-form-bottom"><small>{{ profile ? `以 ${profile.nickname} 的社区身份回复` : '首次回复时建立社区档案' }}</small><v-btn data-testid="community-send-reply" class="c-button primary" :disabled="busy" :ripple="true" color="primary" variant="flat" type="submit">{{ busy ? '正在提交…' : '发送回复' }}</v-btn></div></form>
            </section>
          </div></div>
        </template>
        <template v-else-if="isEditor">
          <div class="c-editor"><div class="c-section-heading"><div><h2>{{ page === 'edit' ? '编辑帖子' : '发布帖子' }}</h2><p class="c-muted">选择分类，清楚描述你的分享或问题。</p></div><small role="status">{{ draftStatus }}</small></div><form class="c-editor-card" @submit.prevent="submitPost"><div class="community-native-field"><v-select v-model="draft.type" :items="editorCategoryItems" label="帖子分类" variant="outlined" density="comfortable" hide-details="auto" :menu-props="{ maxHeight: 440 }"><template #item="{ props: itemProps, item }"><v-list-subheader v-if="item.header">{{ item.title }}</v-list-subheader><v-list-item v-else v-bind="itemProps" /></template></v-select></div><div class="community-native-field"><v-text-field v-model="draft.title" data-testid="community-post-title" maxlength="80" required placeholder="用一句话说清你想分享或解决的事" :label="isResourceDraft ? '资源名称' : '帖子标题'" variant="outlined" density="comfortable" hide-details="auto" /></div><div class="c-fields-row"><div class="community-native-field"><v-text-field v-model="draft.version" maxlength="40" :required="requiresGameVersion" placeholder="例如 1.21.1" :label="requiresGameVersion ? '游戏版本' : '游戏版本（可选）'" variant="outlined" density="comfortable" hide-details="auto" /></div><div class="community-native-field"><v-select v-model="draft.loader" :items="loaders" label="加载器" variant="outlined" density="comfortable" hide-details="auto" /></div></div><div v-if="draft.type === 'help'" class="c-notice">建议包含：问题描述、复现步骤、已尝试方法。粘贴日志前移除令牌、邮箱与个人路径。</div><template v-if="isResourceDraft"><div class="community-native-field"><v-text-field v-model="draft.source_url" type="url" maxlength="2048" required placeholder="https://…" label="来源链接" variant="outlined" density="comfortable" hide-details="auto" /><small>分享来源链接，暂不托管安装包。</small></div><div class="community-native-field"><v-text-field v-model="draft.original_author" maxlength="80" required placeholder="注明资源的作者或团队" label="原作者" variant="outlined" density="comfortable" hide-details="auto" /></div></template><v-tabs v-model="preview" class="editor-tabs" color="primary" density="comfortable"><v-tab :value="false">编辑正文</v-tab><v-tab :value="true">阅读预览</v-tab></v-tabs><div v-if="preview" class="c-preview"><CommunityMarkdown :text="draft.body || '写下内容后，可以在这里预览。'" @link="showExternal" @notice="notify" /></div><div v-else class="community-native-field community-body-field"><v-textarea v-model="draft.body" data-testid="community-post-body" rows="9" minlength="10" maxlength="20000" placeholder="写下你的发现、想法，或需要帮助的地方……"  label="正文" variant="outlined" hide-details="auto" /><small>支持 Markdown · 至少 10 个字符 · 最多 20,000 个字符</small></div><p v-if="editorError" class="c-form-error" role="alert">{{ editorError }}</p><div class="c-form-bottom"><small>发布前请确认没有包含个人隐私或密钥。</small><v-btn data-testid="community-publish" class="c-button primary" :disabled="busy" :ripple="true" color="primary" variant="flat" type="submit">{{ busy ? '正在提交…' : page === 'edit' ? '保存修改' : '发布帖子' }}</v-btn></div></form></div>
        </template>
        <template v-else-if="page === 'me'">
          <section class="c-profile-card"><span class="c-avatar large">{{ profile?.nickname.slice(0, 1) || '我' }}</span><div><h2>{{ profile?.nickname || '我的社区' }}</h2><p>{{ verifiedMinecraft ? 'Minecraft 正版账号 · 昵称与游戏同步' : '尚未登录 Minecraft 正版账号' }}{{ profile?.muted ? ' · 已禁言' : '' }}</p></div><v-btn v-if="!verifiedMinecraft" class="c-button small" @click="editProfile" :ripple="true" color="primary" variant="tonal" size="small" type="button">{{ profile ? '修改昵称' : '建立档案' }}</v-btn><v-btn v-if="isStaff" class="c-button small" @click="openView('moderation')" :ripple="true" color="primary" variant="tonal" size="small" type="button">社区管理</v-btn></section><div class="c-personal-tabs"><v-tabs :model-value="personalTab" color="primary" @update:model-value="value => openView('me', value === 'saved' ? { tab: 'saved' } : {})" aria-label="我的社区内容"><v-tab value="posts">我的帖子</v-tab><v-tab value="saved">我的收藏</v-tab></v-tabs><v-btn variant="text" @click="beginPost">本地草稿</v-btn></div><CommunityPostRows v-if="personalPosts.length" :posts="personalPosts" @open="openPost" /><div v-else class="c-empty"><h2>{{ personalTab === 'saved' ? '把有帮助的经验留在身边' : '第一份分享，从这里开始' }}</h2><p>{{ personalTab === 'saved' ? '打开帖子后点击收藏，稍后可以在这里找到。' : '分享一份教程，或者提出你关心的问题。' }}</p><v-btn class="c-button" :disabled="!ready" @click="personalTab === 'saved' ? openView('list') : beginPost()" :ripple="true" color="primary" variant="tonal" type="button">{{ personalTab === 'saved' ? '浏览讨论' : '发布帖子' }}</v-btn></div><v-btn v-if="personalCursor" class="c-button" :disabled="busy" @click="runLoad(() => loadPersonal(true))" :ripple="true" color="primary" variant="tonal" type="button">加载更多</v-btn>
        </template>
        <template v-else-if="page === 'notifications'"><div class="c-section-heading"><h2>通知中心</h2><v-btn class="c-button quiet small" :disabled="busy || !notifications.length" @click="readNotifications" :ripple="true" color="primary" variant="text" size="small" type="button">全部标为已读</v-btn></div><div v-if="notifications.length" class="c-notifications"><article v-for="notice in notifications" :key="notice.id"><span class="c-avatar">{{ notice.actor_name.slice(0, 1) }}</span><v-btn @click="notice.kind === 'system' ? (systemNotice = notice, systemNoticeShown = true) : openPost(notice.post_id, notice.comment_id || undefined)" :ripple="true" variant="text" type="button"><strong>{{ notice.actor_name }}</strong> {{ noticeLabels[notice.kind] || (notice.kind === 'system' ? '发来一条系统消息' : '更新了与你相关的内容') }}<p>{{ notice.title }}</p><small>{{ communityTime(notice.created_at) }}</small></v-btn><span v-if="!notice.read_at" class="c-unread" /></article></div><div v-else class="c-empty"><v-icon :size="28">notifications_none</v-icon><h2>暂时没有新通知</h2><p>有人回复你，或者采纳了你的经验，会在这里告诉你。</p></div><div v-if="notificationsCursor || systemMessagesCursor" class="c-load-more"><v-btn class="c-button" :disabled="busy" @click="runLoad(() => loadNotifications(true))" :ripple="true" color="primary" variant="tonal" type="button">加载更多通知</v-btn></div></template>
        <template v-else-if="page === 'moderation' && isStaff"><div class="c-section-heading"><h2>社区自动审核</h2><v-btn color="primary" variant="tonal" @click="openAdminConsole">打开 TMCL 管理端</v-btn></div><v-alert type="info" variant="tonal">帖子、回复及举报由系统规则与 DeepSeek 自动审核。审核服务异常时保留待审并自动重试，不提供人工放行。帖子管理、版块配置、公告与消息发送请使用独立管理端。</v-alert></template>
      </template>
      </div></Transition>
    </div>
    <v-dialog v-model="profileDialog" max-width="430"><div class="c-dialog"><h2>{{ profile ? '修改社区昵称' : '建立社区档案' }}</h2><p>这个昵称用于社区交流，不会修改你的 Minecraft 游戏昵称。{{ isDeviceIdentity ? '当前为设备身份，请保留这台设备的账号数据。' : '' }}</p><form @submit.prevent="saveProfile"><div class="community-native-field"><v-text-field v-model="nickname" data-testid="community-nickname" minlength="2" maxlength="24" required autofocus label="社区昵称" variant="outlined" density="comfortable" hide-details="auto" /></div><p v-if="profileError" class="c-form-error" role="alert">{{ profileError }}</p><div class="c-dialog-actions"><v-btn type="button" class="c-button quiet" @click="profileDialog = false" :ripple="true" color="primary" variant="text">取消</v-btn><v-btn class="c-button primary" :disabled="busy" :ripple="true" color="primary" variant="flat" type="submit">{{ busy ? '正在保存…' : '保存档案' }}</v-btn></div></form></div></v-dialog>
    <v-dialog v-model="leaveDialog" persistent max-width="430"><div class="c-dialog"><h2>离开编辑？</h2><p>草稿已尽力保存在这台设备。{{ draftStatus.includes('失败') ? '本机保存失败，请先复制正文，避免丢失。' : '下次发布时可以继续。' }}</p><div class="c-dialog-actions"><v-btn class="c-button quiet" @click="finishLeave(false)" :ripple="true" color="primary" variant="text" type="button">继续编辑</v-btn><v-btn class="c-button primary" @click="finishLeave(true)" :ripple="true" color="primary" variant="flat" type="button">保留草稿并离开</v-btn></div></div></v-dialog>
    <v-dialog v-model="commentDialog" max-width="540"><div class="c-dialog"><h2>编辑回复</h2><p>修改已被采纳的回复后，原采纳状态会清除，由求助作者重新确认。</p><form @submit.prevent="saveComment"><div class="community-native-field"><v-textarea v-model="commentEditBody" minlength="1" maxlength="2000" required rows="5"  label="回复内容" variant="outlined" hide-details="auto" /></div><p v-if="dialogError" class="c-form-error" role="alert">{{ dialogError }}</p><div class="c-dialog-actions"><v-btn type="button" class="c-button quiet" @click="commentDialog = false" :ripple="true" color="primary" variant="text">取消</v-btn><v-btn class="c-button primary" :disabled="busy" :ripple="true" color="primary" variant="flat" type="submit">保存回复</v-btn></div></form></div></v-dialog>
    <v-dialog v-model="reportDialog" max-width="450"><div class="c-dialog"><h2>举报内容</h2><p>说明原因，系统会重新审核相关内容。请勿在举报中填写密码或令牌。</p><form @submit.prevent="submitReport"><div class="community-native-field"><v-select v-model="reportReason" :items="reportReasons" label="举报原因" variant="outlined" hide-details="auto" /></div><p v-if="dialogError" class="c-form-error" role="alert">{{ dialogError }}</p><div class="c-dialog-actions"><v-btn type="button" class="c-button quiet" @click="reportDialog = false" :ripple="true" color="primary" variant="text">取消</v-btn><v-btn class="c-button primary" :disabled="busy" :ripple="true" color="primary" variant="flat" type="submit">提交举报</v-btn></div></form></div></v-dialog>
    <v-dialog v-model="moderationDialog" max-width="450"><div class="c-dialog"><h2>{{ actionLabels[moderationAction.action] || '管理内容' }}</h2><form @submit.prevent="submitModeration"><div class="community-native-field"><v-textarea v-model="moderationReason" minlength="2" maxlength="500" required rows="3"  label="处理说明（将记录在管理日志）" variant="outlined" hide-details="auto" /></div><p v-if="dialogError" class="c-form-error" role="alert">{{ dialogError }}</p><div class="c-dialog-actions"><v-btn type="button" class="c-button quiet" @click="moderationDialog = false" :ripple="true" color="primary" variant="text">取消</v-btn><v-btn class="c-button primary" :disabled="busy" :ripple="true" color="primary" variant="flat" type="submit">确认处理</v-btn></div></form></div></v-dialog>
    <v-dialog v-model="externalDialog" max-width="460"><div class="c-dialog"><h2>打开外部链接</h2><p>即将在浏览器打开以下网站，请核实来源。</p><p class="c-external-url">{{ externalUrl }}</p><div class="c-dialog-actions"><v-btn class="c-button quiet" @click="externalDialog = false" :ripple="true" color="primary" variant="text" type="button">取消</v-btn><v-btn class="c-button primary" @click="openExternal" :ripple="true" color="primary" variant="flat" type="button">打开网站</v-btn></div></div></v-dialog>
    <v-dialog v-model="systemNoticeShown" max-width="560"><v-card class="pa-6"><v-card-title class="px-0">{{ systemNotice?.title }}</v-card-title><v-card-subtitle class="px-0">{{ systemNotice?.actor_name }} · {{ systemNotice ? communityTime(systemNotice.created_at) : '' }}</v-card-subtitle><v-card-text class="px-0" style="white-space:pre-wrap;line-height:1.9">{{ systemNotice?.body }}</v-card-text><v-card-actions class="px-0"><v-spacer /><v-btn color="primary" variant="flat" @click="systemNoticeShown = false">知道了</v-btn></v-card-actions></v-card></v-dialog>
    <CommunityResourceImport v-if="post?.source_url" v-model="resourceImportShown" :source="post.source_url" :author="post.original_author" />
    <v-snackbar v-model="toastVisible" :timeout="4000">{{ toastMessage }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import CommunityResourceImport from '@/components/CommunityResourceImport.vue'
import CommunityMarkdown from '@/components/CommunityMarkdown.vue'
import CommunityPostRows from '@/components/CommunityPostRows.vue'
import { useService } from '@/composables/service'
import { kUserContext } from '@/composables/user'
import { getCommunityInfo } from '@/util/community'
import { CommunityError, applyCommunityBoards, communityStaffKinds, communityGroups, communityResourceKinds, communityKinds, communityTime, createCommunityClient, parseCommunityExternalLink, type CommunityComment, type CommunityKind, type CommunityNotice, type CommunityPage, type CommunityPost, type CommunityProfile, type CommunityReport } from '@/util/communityForum'
import { XmclAccountServiceKey } from '@xmcl/runtime-api'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

const resourceImportShown = ref(false)
function isModrinthResource(value: string) { try { const u = new URL(value); return u.protocol === 'https:' && ['modrinth.com', 'www.modrinth.com'].includes(u.hostname) && /^\/(mod|modpack|resourcepack|shader)\/[a-zA-Z0-9_-]+/.test(u.pathname) } catch { return false } }
const route = useRoute()
const router = useRouter()
const accountService = useService(XmclAccountServiceKey)
const user = inject(kUserContext, undefined)
const subject = ref('')
const identityReady = ref(false)
const identityError = ref('')
const profile = ref<CommunityProfile | null>(null)
const client = createCommunityClient(async force => { const selectedId = user?.userProfile.value.id; const access = await accountService.getCommunityAccess(force, selectedId); if (destroyed || selectedId !== user?.userProfile.value.id) throw new Error('community_identity_changed'); subject.value = access.subject; verifiedMinecraft.value = access.minecraft; return access })
const connected = ref(false), ready = ref(false), infoLoading = ref(false), automaticReview = ref(false)
const page = computed(() => typeof route.query.view === 'string' && ['post', 'new', 'edit', 'me', 'notifications', 'moderation'].includes(route.query.view) ? route.query.view : 'list')
const verifiedMinecraft = ref<{ id: string; name: string }>()
const isResourceDraft = computed(() => communityResourceKinds.includes(draft.type))
const requiresGameVersion = computed(() => isResourceDraft.value || draft.type === 'help')
const editorGroups = computed(() => communityGroups.map(g => ({ ...g, items: g.items.filter(i => !communityStaffKinds.includes(i.value) || isStaff.value) })))
const editorCategoryItems = computed(() => [
  ...editorGroups.value.flatMap(group => [{ title: group.title, value: `group-${group.title}`, header: true, props: { disabled: true } }, ...group.items.map(item => ({ ...item, header: false, props: { disabled: false } }))]),
  ...(draft.type === 'pack' ? [{ title: '整合包（旧分类）', value: 'pack', header: false, props: { disabled: false } }] : []),
])
const isEditor = computed(() => page.value === 'new' || page.value === 'edit')
const isStaff = computed(() => profile.value?.role === 'admin' || profile.value?.role === 'moderator')
const isDeviceIdentity = computed(() => !verifiedMinecraft.value)
const categoryCounts = ref<Record<string, number>>({})
const categoryGroupTitle = computed(() => communityGroups.find(g => g.items.some(i => i.value === category.value))?.title || '浏览全部讨论')
const communityViewKey = computed(() => `${page.value}:${route.query.id || ''}:${route.query.tab || ''}`)
const category = ref('all'), search = ref(''), sort = ref('latest')
const hasFilters = computed(() => category.value !== 'all' || !!search.value)
const posts = ref<CommunityPost[]>([]), listCursor = ref<string | null>(), listLoading = ref(false), listError = ref('')
const post = ref<CommunityPost>(), comments = ref<CommunityComment[]>([]), commentsCursor = ref<string | null>()
const pageLoading = ref(false), viewError = ref(''), busy = ref(false)
const scrollRoot = ref<HTMLElement>(), replyInput = ref<{ focus(): void }>(), listScroll = ref(0)
const personalPosts = ref<CommunityPost[]>([]), personalCursor = ref<string | null>()
const personalTab = computed(() => route.query.tab === 'saved' ? 'saved' : 'posts')
const systemNotice = ref<CommunityNotice>(), systemNoticeShown = ref(false)
const notifications = ref<CommunityNotice[]>([]), notificationsCursor = ref<string | null>(), systemMessagesCursor = ref<string | null>(), unread = ref(0), readBefore = ref(0)
type QueuePost = Pick<CommunityPost, 'id' | 'title' | 'author' | 'author_id' | 'status' | 'locked' | 'revision' | 'created_at' | 'type'>
const pending = ref<QueuePost[]>([]), reports = ref<CommunityReport[]>([]), managed = ref<QueuePost[]>([]), hiddenComments = ref<CommunityComment[]>([]), mutedProfiles = ref<CommunityProfile[]>([])
const replyBody = ref(''), replyTarget = ref<CommunityComment>()
const toastVisible = ref(false), toastMessage = ref('')
const profileDialog = ref(false), nickname = ref(''), profileError = ref('')
const leaveDialog = ref(false), reportDialog = ref(false), moderationDialog = ref(false), externalDialog = ref(false), dialogError = ref(''), externalUrl = ref('')
const commentDialog = ref(false), commentEditBody = ref(''), editingComment = ref<CommunityComment>()
const reportTarget = ref({ target_type: 'post', target_id: '' }), reportReason = ref('广告或刷屏')
const reportReasons = ['广告或刷屏', '不友善或骚扰', '侵权或未注明来源', '恶意内容或不安全链接', '其他不当内容']
const moderationAction = ref({ action: '', target_type: '', target_id: '', revision: undefined as number | undefined }), moderationReason = ref('')
const actionLabels: Record<string, string> = { approve: '审核通过', hide: '隐藏内容', restore: '恢复内容', lock: '锁定帖子', unlock: '解锁帖子', dismiss: '忽略举报', mute: '禁言作者', unmute: '解除禁言' }
const noticeLabels: Record<string, string> = { reply: '回复了你的讨论', accepted: '采纳了你的回复', edited: '编辑了讨论中的回复', approved: '审核通过或恢复了你的内容', hidden: '隐藏了你的内容' }
const loaders = ['不限', '原版', 'Fabric', 'Forge', 'NeoForge', 'Quilt']
const freshDraft = () => ({ type: 'talk' as CommunityKind, title: '', body: '', version: '', loader: '不限', source_url: '', original_author: '', revision: 1 })
const draft = reactive(freshDraft()), preview = ref(false), editorError = ref(''), draftStatus = ref('草稿仅保存在本机'), dirty = ref(false)
let listController: AbortController | undefined, pageController: AbortController | undefined
let reviewTimer: ReturnType<typeof setTimeout> | undefined, reviewPollAttempts = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined, draftTimer: ReturnType<typeof setTimeout> | undefined
let pageGeneration = 0, loadingDraft = false, draftKey = '', leavingAfterSubmit = false, destroyed = false
let afterProfile: (() => void) | undefined, leaveResolver: ((value: boolean) => void) | undefined
let publishKey = '', publishPayload = '', replyKey = '', replyPayload = '', lastNoticeCheck = 0

function notify(message: string) { toastMessage.value = message; toastVisible.value = true }
function message(error: unknown) { return error instanceof CommunityError ? error.message + (error.retryAfter ? `（约 ${error.retryAfter} 秒后重试）` : '') : '操作暂时未完成，请重试。' }
async function refreshInfo() {
  infoLoading.value = true
  const [info, boards] = await Promise.allSettled([getCommunityInfo(AbortSignal.timeout(10000)), client.request<{ data: unknown }>('/categories')])
  if (!destroyed) {
    if (info.status === 'fulfilled') { connected.value = true; ready.value = info.value.status === 'ready'; automaticReview.value = !!info.value.automatic_review }
    else { connected.value = false; ready.value = false }
    if (boards.status === 'fulfilled') applyCommunityBoards(boards.value.data)
    infoLoading.value = false
  }
}
let identityGeneration = 0
async function loadProfile() {
  const generation = ++identityGeneration
  try { const result = await client.request<{ data: CommunityProfile | null }>('/me', { auth: true }); if (!destroyed && generation === identityGeneration) { profile.value = result.data; identityReady.value = true; identityError.value = '' } }
  catch (error) { if (!destroyed && generation === identityGeneration) { identityReady.value = false; identityError.value = message(error) } }
}
async function reconnect() { await loadProfile(); if (identityReady.value) { await loadPage(); notify('社区身份已连接') } }
async function openView(view: string, extra: Record<string, string> = {}) { await router.push({ path: '/community', query: view === 'list' ? {} : { view, ...extra } }) }
function openPost(id: string, comment?: string) { if (page.value === 'list') listScroll.value = scrollRoot.value?.scrollTop || 0; void openView('post', { id, ...(comment ? { comment } : {}) }) }
async function ensureProfile(next?: () => void) {
  if (!identityReady.value) await loadProfile()
  if (!identityReady.value) { notify(identityError.value || '请重试社区身份连接。'); return false }
  if (!verifiedMinecraft.value) { notify('请先在个人中心登录 Minecraft 正版微软账号，再参与社区。'); await router.push('/me'); return false }
  if (!profile.value) { afterProfile = next; nickname.value = user?.gameProfile.value.name || '玩家'; profileError.value = ''; profileDialog.value = true; return false }
  return true
}
async function beginPost() { if (isEditor.value) return; if (await ensureProfile(() => { void openView('new') })) await openView('new') }
function editProfile() { nickname.value = profile.value?.nickname || user?.gameProfile.value.name || '玩家'; profileError.value = ''; profileDialog.value = true }
async function saveProfile() {
  if (busy.value) return; busy.value = true; profileError.value = ''
  try { const response = await client.request<{ data: CommunityProfile }>('/me', { method: 'PUT', auth: true, body: { nickname: nickname.value } }); profile.value = response.data; identityReady.value = true; identityError.value = ''; const next = afterProfile; afterProfile = undefined; profileDialog.value = false; notify('社区档案已保存'); busy.value = false; if (next) next(); else if (page.value === 'me') await loadPersonal() }
  catch (error) { profileError.value = message(error) } finally { busy.value = false }
}
async function loadPosts(append = false) {
  listController?.abort(); const controller = new AbortController(); listController = controller
  listLoading.value = true; listError.value = ''
  const params = new URLSearchParams({ sort: sort.value })
  if (category.value !== 'all') params.set('type', category.value)
  if (search.value?.trim()) params.set('q', search.value.trim())
  if (append && listCursor.value) params.set('cursor', listCursor.value)
  try { const result = await client.request<CommunityPage<CommunityPost>>(`/posts?${params}`, { auth: identityReady.value, signal: controller.signal }); if (!controller.signal.aborted && !destroyed) { categoryCounts.value = result.category_counts || categoryCounts.value; posts.value = append ? [...posts.value, ...result.data.filter(p => !posts.value.some(x => x.id === p.id))] : result.data; listCursor.value = result.next_cursor } }
  catch (error) { if (!controller.signal.aborted && !destroyed) listError.value = message(error) } finally { if (!controller.signal.aborted) listLoading.value = false }
}
async function loadComments(append = false) {
  if (!post.value) return
  const id = post.value.id
  const params = append && commentsCursor.value ? `?cursor=${encodeURIComponent(commentsCursor.value)}` : ''
  const result = await client.request<CommunityPage<CommunityComment>>(`/posts/${id}/comments${params}`, { auth: identityReady.value })
  if (post.value?.id === id && !destroyed) { comments.value = append ? [...comments.value, ...result.data.filter(c => !comments.value.some(x => x.id === c.id))] : result.data; commentsCursor.value = result.next_cursor }
}
async function loadPersonal(append = false) {
  if (!profile.value) { personalPosts.value = []; return }
  const params = new URLSearchParams({ [personalTab.value === 'saved' ? 'saved' : 'mine']: '1' })
  if (append && personalCursor.value) params.set('cursor', personalCursor.value)
  const result = await client.request<CommunityPage<CommunityPost>>(`/posts?${params}`, { auth: true })
  personalPosts.value = append ? [...personalPosts.value, ...result.data.filter(p => !personalPosts.value.some(x => x.id === p.id))] : result.data; personalCursor.value = result.next_cursor
}
async function loadNotifications(append = false) {
  if (!identityReady.value || !profile.value) { notifications.value = []; unread.value = 0; return }
  const cursors = new URLSearchParams()
  if (append && notificationsCursor.value) cursors.set('cursor', notificationsCursor.value)
  if (append && systemMessagesCursor.value) cursors.set('messages_cursor', systemMessagesCursor.value)
  const result = await client.request<{ data: CommunityNotice[]; system_messages?: Array<Omit<CommunityNotice, 'kind' | 'post_id' | 'comment_id'>>; system_messages_cursor?: string | null; unread: number; read_before: number; next_cursor?: string | null }>(`/notifications${cursors.size ? '?' + cursors.toString() : ''}`, { auth: true })
  result.data = [...result.data, ...(result.system_messages || []).map(n => ({ ...n, kind: 'system', post_id: '', comment_id: null }))].sort((a, b) => b.created_at - a.created_at)
  notifications.value = append ? [...notifications.value, ...result.data.filter(n => !notifications.value.some(x => x.id === n.id))] : result.data; notificationsCursor.value = result.next_cursor; systemMessagesCursor.value = result.system_messages_cursor; unread.value = result.unread; if (!append) readBefore.value = result.read_before; lastNoticeCheck = Date.now()
}
async function runLoad(operation: () => Promise<void>) { if (busy.value) return; busy.value = true; try { await operation() } catch (error) { notify(message(error)) } finally { busy.value = false } }
async function readNotifications() { if (busy.value) return; busy.value = true; try { await client.request('/notifications/read', { method: 'PUT', auth: true, body: { before: readBefore.value } }); await loadNotifications() } catch (e) { notify(message(e)) } finally { busy.value = false } }
async function loadModeration() {
  if (!isStaff.value) throw new CommunityError('forbidden', '此页面需要版主权限。')
  const result = await client.request<{ data: CommunityReport[]; pending: QueuePost[]; managed: QueuePost[]; hidden_comments: CommunityComment[]; muted: CommunityProfile[] }>('/moderation/reports', { auth: true })
  reports.value = result.data; pending.value = result.pending; managed.value = result.managed; hiddenComments.value = result.hidden_comments; mutedProfiles.value = result.muted || []
}
async function loadPage() {
  const generation = ++pageGeneration
  pageController?.abort(); const controller = new AbortController(); pageController = controller
  pageLoading.value = true; viewError.value = ''; replyTarget.value = undefined; replyBody.value = ''
  try {
    if (page.value === 'list') { await loadPosts(); await nextTick(); if (scrollRoot.value) scrollRoot.value.scrollTop = listScroll.value }
    else if (page.value === 'post') {
      const id = typeof route.query.id === 'string' ? route.query.id : ''
      const result = await client.request<{ data: CommunityPost }>(`/posts/${id}`, { auth: identityReady.value, signal: controller.signal })
      if (generation !== pageGeneration) return; post.value = result.data; comments.value = []; await loadComments()
      if (route.query.comment) { await nextTick(); scrollRoot.value?.querySelector(`#${CSS.escape(String(route.query.comment))}`)?.scrollIntoView({ block: 'center' }) }
    } else if (isEditor.value) await loadEditor(controller.signal)
    else if (page.value === 'me') await loadPersonal()
    else if (page.value === 'notifications') await loadNotifications()
    else if (page.value === 'moderation') await loadModeration()
  } catch (error) { if (!controller.signal.aborted && generation === pageGeneration && !destroyed) viewError.value = message(error) }
  finally { if (generation === pageGeneration) pageLoading.value = false }
}
function clearFilters() { category.value = 'all'; search.value = '' }
async function loadEditor(signal: AbortSignal) {
  loadingDraft = true; dirty.value = false; preview.value = false; editorError.value = ''; draftStatus.value = '草稿仅保存在本机'
  try {
    if (!identityReady.value) await loadProfile()
    if (!subject.value) throw new CommunityError('session_missing', '请先重试社区身份连接。')
    let source = freshDraft()
    if (page.value === 'edit') { const result = await client.request<{ data: CommunityPost }>(`/posts/${String(route.query.id || '')}`, { auth: true, signal }); if (!result.data.mine) throw new CommunityError('forbidden', '只能编辑自己的帖子。'); source = { ...source, ...result.data, body: result.data.body || '' } }
    draftKey = `tora-community-draft:${subject.value}:${page.value === 'edit' ? String(route.query.id) : 'new'}`
    try { const saved: unknown = JSON.parse(localStorage.getItem(draftKey) || 'null'); if (saved && typeof saved === 'object') { const values = saved as Record<string, unknown>; for (const k of Object.keys(source) as Array<keyof typeof source>) { if (typeof values[k] === typeof source[k]) (source as Record<string, unknown>)[k] = values[k] } draftStatus.value = '已恢复这台设备上的草稿' } } catch { draftStatus.value = '无法读取本机草稿，请重新输入' }
    Object.assign(draft, { type: source.type, title: source.title, body: source.body, version: source.version, loader: source.loader, source_url: source.source_url, original_author: source.original_author, revision: source.revision })
    await nextTick()
  } finally { loadingDraft = false }
}
function beforeUnload() { saveDraft() }
function saveDraft() { if (!draftKey || !isEditor.value) return; try { localStorage.setItem(draftKey, JSON.stringify(draft)); draftStatus.value = '草稿已保存在本机' } catch { draftStatus.value = '本机草稿保存失败，请先复制正文' } }
function confirmLeave() { saveDraft(); leaveDialog.value = true; return new Promise<boolean>(resolve => { leaveResolver = resolve }) }
function finishLeave(value: boolean) { leaveDialog.value = false; leaveResolver?.(value); leaveResolver = undefined }
async function submitPost() {
  if (busy.value) return
  if (!await ensureProfile(() => { void submitPost() })) return
  if (draft.body.trim().length < 10) { editorError.value = '正文至少需要 10 个字符，请补充具体信息。'; return }
  busy.value = true; editorError.value = ''
  const payload = JSON.stringify(draft)
  if (payload !== publishPayload) { publishPayload = payload; publishKey = crypto.randomUUID() }
  try { const result = await client.request<{ data: CommunityPost }>(page.value === 'edit' ? `/posts/${String(route.query.id)}` : '/posts', { method: page.value === 'edit' ? 'PATCH' : 'POST', body: JSON.parse(payload), auth: true, key: publishKey }); try { localStorage.removeItem(draftKey) } catch { /* Successful content exists on server. */ } dirty.value = false; leavingAfterSubmit = true; await openView('post', { id: result.data.id }); notify(result.data.status === 'pending' ? '已提交，等待版主审核；可在我的帖子查看。' : '帖子已保存') }
  catch (error) { editorError.value = message(error); saveDraft() } finally { busy.value = false; leavingAfterSubmit = false }
}
function setReply(comment: CommunityComment) { replyTarget.value = comment; nextTick(() => replyInput.value?.focus()) }
async function submitReply() {
  if (busy.value || !post.value || !replyBody.value.trim()) return
  if (!await ensureProfile(() => { void submitReply() })) return
  busy.value = true
  const body = { body: replyBody.value.trim(), parent_id: replyTarget.value?.id }
  const payload = JSON.stringify(body)
  if (payload !== replyPayload) { replyPayload = payload; replyKey = crypto.randomUUID() }
  try { await client.request(`/posts/${post.value.id}/comments`, { method: 'POST', auth: true, key: replyKey, body }); replyBody.value = ''; replyTarget.value = undefined; replyPayload = ''; await refreshPost(); notify(automaticReview.value ? '回复已提交，系统审核后自动公开' : '回复已发布') }
  catch (error) { notify(message(error)) } finally { busy.value = false }
}
async function refreshPost() { if (!post.value) return; const result = await client.request<{ data: CommunityPost }>(`/posts/${post.value.id}`, { auth: identityReady.value }); post.value = result.data; await loadComments() }
async function interact(kind: 'like' | 'bookmark') {
  if (busy.value || !post.value) return
  if (!await ensureProfile(() => { void interact(kind) })) return
  busy.value = true
  try { const selected = kind === 'like' ? post.value.liked : post.value.bookmarked; const result = await client.request<{ data: CommunityPost }>(`/posts/${post.value.id}/${kind}`, { method: selected ? 'DELETE' : 'PUT', auth: true, body: {} }); post.value = result.data }
  catch (error) { notify(message(error)) } finally { busy.value = false }
}
async function acceptAnswer(comment: CommunityComment) { if (busy.value || !post.value) return; busy.value = true; try { const result = await client.request<{ data: CommunityPost }>(`/posts/${post.value.id}/accepted-answer`, { method: post.value.accepted_comment_id === comment.id ? 'DELETE' : 'PUT', auth: true, body: { comment_id: comment.id } }); post.value = result.data } catch (error) { notify(message(error)) } finally { busy.value = false } }
function editComment(comment: CommunityComment) { editingComment.value = comment; commentEditBody.value = comment.body; dialogError.value = ''; commentDialog.value = true }
async function saveComment() { if (busy.value || !editingComment.value) return; busy.value = true; try { await client.request(`/comments/${editingComment.value.id}`, { method: 'PATCH', auth: true, body: { body: commentEditBody.value, revision: editingComment.value.revision } }); commentDialog.value = false; await refreshPost(); notify('回复已保存') } catch (error) { dialogError.value = message(error) } finally { busy.value = false } }
async function openReport(type: string, id: string) { if (await ensureProfile(() => { void openReport(type, id) })) { reportTarget.value = { target_type: type, target_id: id }; reportReason.value = reportReasons[0]; dialogError.value = ''; reportDialog.value = true } }
async function submitReport() { if (busy.value) return; busy.value = true; try { await client.request('/reports', { method: 'POST', auth: true, body: { ...reportTarget.value, reason: reportReason.value } }); reportDialog.value = false; notify('举报已提交，系统会重新审核。') } catch (error) { dialogError.value = message(error) } finally { busy.value = false } }
function openModeration(action: string, target_type: string, target_id: string, revision?: number) { moderationAction.value = { action, target_type, target_id, revision }; moderationReason.value = action === 'approve' ? '审核通过' : ''; dialogError.value = ''; moderationDialog.value = true }
async function submitModeration() { if (busy.value) return; busy.value = true; try { await client.request('/moderation/actions', { method: 'POST', auth: true, body: { ...moderationAction.value, reason: moderationReason.value } }); moderationDialog.value = false; if (page.value === 'post') await refreshPost(); else await loadModeration(); notify('处理已保存并记录到管理日志') } catch (error) { dialogError.value = message(error) } finally { busy.value = false } }
function showExternal(value: string) { try { externalUrl.value = parseCommunityExternalLink(value); externalDialog.value = true } catch { notify('此链接无效，或指向启动器内部地址，无法从社区打开。') } }
function sourceHost(value: string) { try { return new URL(value).hostname } catch { return '外部网站' } }
function openAdminConsole() { window.open('https://154.8.230.216/admin/', 'browser') }
function openExternal() { window.open(externalUrl.value, 'browser'); externalDialog.value = false }
function scheduleReviewRefresh() {
  if (reviewTimer) clearTimeout(reviewTimer)
  if (destroyed || page.value !== 'post' || !post.value || (post.value.status !== 'pending' && !comments.value.some(c => c.status === 'pending')) || reviewPollAttempts >= 30) return
  reviewTimer = setTimeout(async () => {
    if (destroyed) return
    if (!document.hidden && !busy.value) { reviewPollAttempts++; try { await refreshPost() } catch { /* Preserve the current content and retry within the bounded window. */ } }
    scheduleReviewRefresh()
  }, 2500)
}
watch([page, () => post.value?.id, () => post.value?.status, () => comments.value.filter(c => c.status === 'pending').length], () => { reviewPollAttempts = 0; scheduleReviewRefresh() })
async function onFocus() {
  if (!document.hidden && Date.now() - lastNoticeCheck > 60000) { try { await loadNotifications() } catch { /* Retry on next focus. */ } }
  if (!document.hidden && page.value === 'post' && post.value?.status === 'pending') { reviewPollAttempts = 0; scheduleReviewRefresh() }
}
watch([() => user?.userProfile.value.id, () => user?.userProfile.value.selectedProfile, () => user?.userProfile.value.expiredAt], async () => {
  saveDraft(); verifiedMinecraft.value = undefined; profile.value = null; identityReady.value = false; subject.value = ''
  await loadProfile(); if (!destroyed) await loadPage()
})
watch([category, search, sort], () => { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (page.value === 'list') { listScroll.value = 0; void loadPosts() } }, 300) })
watch(draft, () => { if (loadingDraft || !isEditor.value) return; dirty.value = true; if (draftTimer) clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 600) })
watch(() => [route.query.view, route.query.id, route.query.tab], async () => { if (scrollRoot.value && page.value !== 'list') scrollRoot.value.scrollTop = 0; await loadPage() })
onBeforeRouteLeave(async () => !isEditor.value || !dirty.value || leavingAfterSubmit || await confirmLeave())
onBeforeRouteUpdate(async () => !isEditor.value || !dirty.value || leavingAfterSubmit || await confirmLeave())
onMounted(async () => { document.title = 'TORA Minecraft Launcher - 社区'; window.addEventListener('focus', onFocus); window.addEventListener('beforeunload', beforeUnload); void refreshInfo(); const initialList = page.value === 'list' ? loadPosts() : undefined; await loadProfile(); if (destroyed) return; if (initialList) { await initialList; if (identityReady.value) await loadPosts() } else await loadPage(); try { await loadNotifications() } catch { /* Public browsing remains available. */ } })
onBeforeUnmount(() => { destroyed = true; if (reviewTimer) clearTimeout(reviewTimer); saveDraft(); listController?.abort(); pageController?.abort(); if (searchTimer) clearTimeout(searchTimer); if (draftTimer) clearTimeout(draftTimer); leaveResolver?.(false); window.removeEventListener('focus', onFocus); window.removeEventListener('beforeunload', beforeUnload) })
</script>

<style scoped>
input,select,textarea{font:inherit;color:inherit}
.community-page{--c-line:rgba(var(--v-theme-on-surface),.09);--c-muted:rgba(var(--v-theme-on-surface),.65);--c-soft:rgba(var(--v-theme-on-surface),.035);display:flex;flex:1;flex-direction:column;min-height:0;min-width:0;color:rgb(var(--v-theme-on-surface))}.community-header{padding:20px 24px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-shrink:0}.community-heading{display:flex;align-items:center;gap:10px;min-width:0}.community-heading>.v-icon{flex-shrink:0}.community-heading h1{font-size:20px;font-weight:600;line-height:1.5;letter-spacing:normal;margin:0}.community-heading p{font-size:12px;color:var(--c-muted);margin-top:4px;white-space:nowrap}.community-header-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}.community-content{padding:0 24px 24px;overflow:auto;flex:1;min-height:0;overscroll-behavior:contain}.community-content>template{min-width:0}.community-grid,.community-reading{display:block;max-width:none;margin:0;min-width:0}.community-feed{min-width:0}.unread-dot,.c-unread{width:6px;height:6px;background:rgb(var(--v-theme-primary));border-radius:50%;flex-shrink:0}.unread-dot{position:absolute;top:5px;right:6px}.c-toolbar{display:flex;gap:12px;align-items:center;padding:16px 0 12px}.c-feed-hint{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--c-muted);margin-bottom:12px;min-height:32px;gap:8px}.c-notice{display:flex;align-items:center;gap:8px;padding:11px 13px;border:1px solid var(--c-line);background:var(--c-soft);border-radius:var(--card-item-radius);font-size:12px;color:var(--c-muted);margin-bottom:12px;line-height:1.7}.c-notice>button{text-align:left;color:rgb(var(--v-theme-on-surface))}.c-notice>span:last-child{margin-left:auto}.c-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:280px;text-align:center;border:var(--card-row-border);border-radius:var(--card-radius);background:rgb(var(--v-theme-surface));padding:36px 24px;color:var(--c-muted)}.c-empty h2{font-size:18px;font-weight:500;color:rgb(var(--v-theme-on-surface));margin:18px 0 8px}.c-empty p{font-size:14px;line-height:1.8;margin:0 0 20px!important;max-width:440px}.c-load-more{text-align:center;margin:20px 0}.c-article,.c-replies,.c-editor-card,.c-profile-card{border:var(--card-row-border);background:rgb(var(--v-theme-surface));border-radius:var(--card-radius);padding:24px;min-width:0}.c-article>h2{font-size:24px;font-weight:600;line-height:1.5;margin:12px 0 18px;overflow-wrap:anywhere}.c-tags{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.c-tag{display:inline-block;font-size:11px;line-height:1.6;padding:2px 6px;border-radius:5px;color:var(--c-muted);background:var(--c-soft)}.c-tag.solved{color:rgb(var(--v-theme-success));background:rgba(var(--v-theme-success),.1)}.c-author{display:flex;align-items:center;gap:10px;margin-bottom:24px;font-size:12px}.c-author small{display:block;font-size:11px;color:var(--c-muted);margin-top:3px}.c-role{margin-left:6px;color:rgb(var(--v-theme-primary));font-size:10px}.c-avatar{width:34px;height:34px;display:grid;place-items:center;flex-shrink:0;border-radius:var(--card-item-radius);background:rgba(var(--v-theme-primary),.08);color:rgb(var(--v-theme-primary));font-size:12px;font-weight:600}.c-article-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;border-top:1px solid var(--c-line);padding-top:18px;margin-top:28px}.c-report{margin-left:auto}.c-source{background:var(--c-soft);border:1px solid var(--c-line);border-radius:var(--card-item-radius);padding:15px;margin-top:22px;font-size:12px}.c-source p{margin:7px 0 12px;color:var(--c-muted)}.c-source small{display:block;font-size:11px;color:var(--c-muted);margin-top:10px}.c-replies{margin-top:18px;padding:22px 25px}.c-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.c-section-heading h2{font-size:20px;font-weight:600}.c-section-heading h3{font-size:15px;font-weight:600}.c-section-heading small{font-size:12px;color:var(--c-muted)}.c-reply{padding:18px 0;display:flex;gap:12px;border-top:1px solid var(--c-line);scroll-margin:18px}.c-reply.accepted{border-left:3px solid #6da484;margin-left:-15px;padding-left:12px}.c-reply.nested{margin-left:25px}.c-reply-copy{min-width:0;flex:1}.c-reply-author{display:flex;gap:8px;align-items:center;font-size:14px;font-weight:500}.c-reply-copy>p{font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0!important}.c-reply-meta{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--c-muted)}.c-reply-meta button:hover{color:rgb(var(--v-theme-primary))}.c-reply-form{border-top:1px solid var(--c-line);padding-top:18px;margin-top:4px}.c-reply-target{display:flex;gap:15px;color:rgb(var(--v-theme-primary));font-size:12px;margin-bottom:10px}.c-reply-target button{font-size:11px;color:var(--c-muted)}.c-form-bottom{display:flex;justify-content:space-between;align-items:center;gap:14px}.c-form-bottom small{font-size:11px;color:var(--c-muted);line-height:1.6}.c-editor{max-width:880px;margin:auto}.c-editor>.c-section-heading p{margin-top:7px}.c-editor>.c-section-heading>small{white-space:nowrap}.c-type-options{display:flex;gap:8px;flex-wrap:wrap}.c-type-options .c-button{min-width:72px}.c-fields-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}.c-preview{min-height:220px;padding:4px 14px;background:var(--c-soft);border-radius:var(--card-item-radius);margin-bottom:20px}.c-form-error{color:rgb(var(--v-theme-error));font-size:12px;line-height:1.8;margin:12px 0}.c-muted{font-size:12px;color:var(--c-muted);line-height:1.8;margin:10px 0}.c-profile-card{display:flex;align-items:center;gap:16px;margin-bottom:22px}.c-profile-card h2{font-size:21px;font-weight:600}.c-profile-card p{font-size:12px;color:var(--c-muted);margin-top:7px}.c-profile-card>.c-button:first-of-type{margin-left:auto}.c-avatar.large{width:54px;height:54px;font-size:18px;border-radius:var(--card-item-radius)}.c-notifications{border:1px solid var(--c-line);background:rgb(var(--v-theme-surface));border-radius:var(--card-item-radius);overflow:hidden}.c-notifications article{display:flex;align-items:center;gap:13px;padding:20px;border-bottom:1px solid var(--c-line)}.c-notifications article:last-child{border:0}.c-notifications button{text-align:left;line-height:1.8;font-size:13px;flex:1}.c-notifications button:hover{color:rgb(var(--v-theme-primary))}.c-notifications p,.c-notifications small{font-size:12px;color:var(--c-muted)}.c-notifications small{font-size:11px}.c-inline-warning{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;line-height:1.8;padding:10px 14px;background:rgba(var(--v-theme-warning),.08);border-radius:var(--card-item-radius);margin-bottom:15px}.c-inline-warning button{color:rgb(var(--v-theme-primary));text-decoration:underline}.c-dialog{--c-line:rgba(var(--v-theme-on-surface),.12);--c-muted:rgba(var(--v-theme-on-surface),.65);--c-soft:rgba(var(--v-theme-on-surface),.035);padding:24px;background:rgb(var(--v-theme-surface));color:rgb(var(--v-theme-on-surface));border-radius:var(--surface-dialog-radius,16px)}.c-dialog h2{font-size:19px;font-weight:600;margin-bottom:15px}.c-dialog>p{font-size:13px;color:rgba(var(--v-theme-on-surface),.68);line-height:1.85;margin-bottom:22px}.c-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.c-external-url{overflow-wrap:anywhere}.c-admin-section{margin-bottom:28px}.c-admin-section>h3{font-size:15px;font-weight:600;margin-bottom:14px}.c-admin-card{padding:18px;border:1px solid var(--c-line);border-radius:var(--card-item-radius);background:rgb(var(--v-theme-surface));margin:10px 0}.c-admin-title{text-align:left;font-size:15px;font-weight:600}.c-admin-title:hover{color:rgb(var(--v-theme-primary))}.c-admin-card>p{font-size:12px;color:var(--c-muted);line-height:1.8;margin:6px 0 12px}.c-admin-card>div{display:flex;gap:8px;flex-wrap:wrap}.c-report-excerpt{white-space:pre-wrap;overflow-wrap:anywhere;max-height:140px;overflow:auto}.c-admin-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:16px}.c-admin-actions small{color:var(--c-muted);font-size:11px}.c-skeleton{border:1px solid var(--c-line);border-radius:var(--card-item-radius);padding:0 20px;background:rgb(var(--v-theme-surface))}.c-skeleton>div{height:115px;border-bottom:1px solid var(--c-line);position:relative}.c-skeleton>div:last-child{border:0}.c-skeleton>div:before,.c-skeleton>div:after{content:'';position:absolute;left:0;right:12%;height:14px;background:var(--c-soft);border-radius:5px;top:28px}.c-skeleton>div:after{top:55px;right:32%;height:10px}

.community-page :is(h1,h2,h3){letter-spacing:normal}
.community-heading p{display:none}
.community-header :deep(.v-btn){text-transform:none;letter-spacing:normal;border-radius:var(--card-item-radius);font-size:14px}
.community-categories{border-bottom:1px solid var(--c-line);flex-shrink:0}
.community-categories :deep(.v-tab){text-transform:none;letter-spacing:normal;font-size:14px;min-width:84px;padding:0 20px}
.community-view{min-width:0}.community-filter-bar{display:flex;align-items:center;gap:12px;min-height:48px;border-bottom:1px solid var(--c-line)}.community-filter-bar .c-muted{margin:0}.community-category-button{text-transform:none;letter-spacing:normal}.community-sort{max-width:160px;flex:0 0 160px}
.c-toolbar :deep(.v-field){border-radius:var(--card-item-radius);font-size:14px;background:rgb(var(--v-theme-surface))}
.c-toolbar :deep(.v-field__outline){--v-field-border-opacity:.16}
.c-toolbar :deep(.v-field__prepend-inner .v-icon){font-size:21px;opacity:.6}



.c-empty-icon{opacity:.35}
.c-empty>.c-button{margin-top:4px}



.community-reading{max-width:1040px}
.c-editor{max-width:1040px}
.c-article>h2{font-size:24px;line-height:1.5;font-weight:600;margin:14px 0 20px}
.c-profile-card{margin-top:0}
.c-section-heading h2{font-size:20px;font-weight:500}
@media(max-width:899px){
 .community-header{padding:16px 20px 12px}.community-content{padding:0 20px 20px}
 .community-connection .connection-label{display:none}
 .c-profile-card{gap:12px;flex-wrap:wrap}.c-article,.c-replies,.c-editor-card{padding:20px}
 .community-categories :deep(.v-tab){min-width:76px;padding:0 16px}
}
@media(max-height:520px){
 .community-header{padding-top:10px;padding-bottom:8px}.c-toolbar{padding-top:12px}
 .c-empty{min-height:180px;padding:20px}.c-empty h2{margin-top:10px}
 .c-feed-hint{margin-bottom:8px}.community-categories :deep(.v-slide-group__container){min-height:38px}
}
@media(prefers-reduced-motion:reduce){.community-page *{transition:none!important;animation:none!important;scroll-behavior:auto!important}}

.community-page :deep(.v-btn),.c-dialog :deep(.v-btn){text-transform:none;letter-spacing:normal;font-family:inherit}
.c-button{flex-shrink:0}
.c-back{margin:12px 0}



.community-native-field{margin-bottom:20px;min-width:0}
.community-native-field>small{display:block;font-size:12px;line-height:1.6;color:var(--c-muted);margin-top:6px}
.community-native-field :deep(.v-field){border-radius:var(--card-item-radius);font-size:14px}
.community-native-field :deep(.v-field__outline){--v-field-border-opacity:.2}
.community-native-field :deep(.v-field--focused .v-field__outline){--v-field-border-opacity:1}
.c-editor>.c-section-heading{margin-top:8px}
.editor-tabs{margin-bottom:20px;border-bottom:1px solid var(--c-line)}
.c-personal-tabs{display:flex;align-items:center;gap:12px;margin-bottom:20px;border-bottom:1px solid var(--c-line)}
.c-personal-tabs>.v-tabs{flex:1}
.c-article-actions .v-btn,.c-admin-actions .v-btn{letter-spacing:normal}
.c-reply-meta .v-btn{font-size:12px;min-width:0;padding:0 8px;height:28px}
.c-notifications .v-btn{height:auto;min-height:44px;justify-content:flex-start;white-space:normal;text-align:left}
.c-notifications :deep(.v-btn__content){display:block;text-align:left;white-space:normal}
.c-admin-title.v-btn{height:auto;min-height:32px;padding:4px 0;white-space:normal;justify-content:flex-start}
.c-admin-title :deep(.v-btn__content){white-space:normal;text-align:left}
.c-dialog .v-btn{font-size:14px}

/* The composer occupies the full content area; long and short windows both scroll safely. */
.community-view--editor{min-height:100%;display:flex;flex-direction:column}
.community-view--editor .c-back{align-self:flex-start;flex-shrink:0}
.community-view--editor .c-editor{width:100%;max-width:none;margin:0;flex:1;display:flex;flex-direction:column;min-height:0}
.community-view--editor .c-section-heading{flex-shrink:0}
.community-view--editor .c-editor-card{flex:1;display:flex;flex-direction:column;min-height:0}
.community-view--editor .community-native-field,.community-view--editor .c-fields-row,.community-view--editor .editor-tabs,.community-view--editor .c-form-bottom{flex-shrink:0}
.community-view--editor .community-body-field{flex:1;display:flex;flex-direction:column;min-height:240px}
.community-body-field :deep(.v-input){flex:1;min-height:0}
.community-body-field :deep(.v-input__control),.community-body-field :deep(.v-field){height:100%}
.community-body-field :deep(textarea){height:100%;min-height:200px}
.community-view--editor .c-preview{flex:1;min-height:240px;overflow:auto}
@media(min-height:760px){.community-view--editor{height:100%}}
</style>
