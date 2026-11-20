package authz_test

import data.authz

laura := {"sub": "laura.martin", "aud": "expenses-api", "roles": ["employee"], "department": "Sales", "amr": ["pwd"]}

marco := {"sub": "marco.ruiz", "aud": "expenses-api", "roles": ["employee", "manager"], "department": "Sales", "amr": ["pwd"]}

ana := {"sub": "ana.lopez", "aud": "expenses-api", "roles": ["employee", "finance"], "department": "Finance", "amr": ["pwd"]}

bot := {"sub": "expense-bot", "aud": "expenses-api", "client_id": "expense-bot", "scope": "expenses:read"}

read(id) := {"method": "GET", "path": ["expenses", id]}

approve(id) := {"method": "POST", "path": ["expenses", id, "approve"]}

ids(set) := {item.id | some item in set}

test_employee_reads_own_expense if {
	authz.allow with input as {"token": laura, "request": read("E-101")}
}

test_employee_cannot_read_others if {
	not authz.allow with input as {"token": laura, "request": read("E-102")}
}

test_manager_reads_team if {
	authz.allow with input as {"token": marco, "request": read("E-101")}
}

test_service_reads_with_scope if {
	authz.allow with input as {"token": bot, "request": read("E-103")}
}

test_service_cannot_approve if {
	d := authz.decision with input as {"token": bot, "request": approve("E-101")}
	not d.allow
	count(d.grants) == 0
}

test_manager_approves_under_limit if {
	authz.allow with input as {"token": marco, "request": approve("E-101")}
}

test_manager_limit if {
	d := authz.decision with input as {"token": marco, "request": approve("E-103")}
	not d.allow
	ids(d.denies) == {"manager-limit", "needs-mfa"}
}

test_limit_comes_from_data if {
	authz.allow with input as {"token": marco, "request": approve("E-101")}
	not authz.allow with input as {"token": marco, "request": approve("E-101")} with data.limits.manager as 100
}

test_own_approval_denied if {
	d := authz.decision with input as {"token": ana, "request": approve("E-104")} with data.expenses["E-104"].status as "submitted"
	ids(d.denies) == {"own-approval"}
}

test_finance_needs_mfa_for_large if {
	d := authz.decision with input as {"token": ana, "request": approve("E-103")}
	ids(d.denies) == {"needs-mfa"}
	authz.allow with input as {"token": object.union(ana, {"amr": ["pwd", "mfa"]}), "request": approve("E-103")}
}

test_only_submitted if {
	d := authz.decision with input as {"token": marco, "request": approve("E-104")}
	"not-submitted" in ids(d.denies)
}

test_wrong_audience if {
	d := authz.decision with input as {"token": object.union(laura, {"aud": "other-api"}), "request": read("E-101")}
	ids(d.denies) == {"audience"}
	not d.allow
}

test_unknown_expense if {
	d := authz.decision with input as {"token": ana, "request": read("E-999")}
	ids(d.denies) == {"unknown"}
}

test_manager_cannot_approve_own_expense if {
	d := authz.decision with input as {"token": marco, "request": approve("E-102")}
	ids(d.denies) == {"own-approval"}
	ids(d.grants) == {"approve-manager"}
}
