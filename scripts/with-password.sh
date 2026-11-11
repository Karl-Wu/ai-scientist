#!/usr/bin/expect -f
# Run ssh/scp non-interactively when DEPLOY_PASSWORD is set.
#
# The password is never placed on a command line (it would leak through `ps`
# and shell history); it is read from the environment by expect only.
#
#   DEPLOY_PASSWORD=... scripts/with-password.sh ssh -o ... root@host "cmd"
#   DEPLOY_PASSWORD=... scripts/with-password.sh scp -o ... file root@host:/tmp/
set timeout -1
set pw $env(DEPLOY_PASSWORD)
set cmd [lindex $argv 0]
set rest [lrange $argv 1 end]
eval spawn $cmd $rest
expect {
  -re "(?i)are you sure you want to continue connecting" { send "yes\r"; exp_continue }
  -re "(?i)password:" { send "$pw\r"; exp_continue }
  eof
}
catch wait result
exit [lindex $result 3]
