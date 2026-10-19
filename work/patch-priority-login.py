from pathlib import Path
p=Path('apps/mobile/pages/booking/confirm.uvue');s=p.read_text(encoding='utf-8')
s=s.replace('<text v-if="s.priorityWindow" class="tag">', '<button v-if="s.priorityWindow&&!currentUser" class="secondary-button" @click="loginForPriority">登录核查优先报名权益</button><text v-if="s.priorityWindow" class="tag">')
s=s.replace('function resetKey(){', "function loginForPriority(){needLogin('/pages/booking/confirm?eventId='+eventId.value);}\nfunction resetKey(){")
p.write_text(s,encoding='utf-8')
p=Path('apps/mobile/pages/auth/login.uvue');s=p.read_text(encoding='utf-8');s=s.replace(".includes(path)||/^\\/pages\\/booking\\/credential", ".includes(path)||/^\\/pages\\/booking\\/confirm\\?eventId=[a-f0-9-]{36}$/.test(path)||/^\\/pages\\/booking\\/credential");p.write_text(s,encoding='utf-8')
