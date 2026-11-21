### Security

- The admin opens only on the server's answer. With Firestore unreachable, the
  access check read an empty cached answer as admin access and opened the admin
  menu, also for an account that is not an admin. That case now shows "We could
  not check your admin access" with "Check again" (#1318).
