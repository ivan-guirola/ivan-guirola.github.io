package authz

# The API sends the caller's token and the request.
# data holds the expenses and the approval limits.

token := input.token

action := "read" if input.request.method == "GET"

action := "approve" if {
	input.request.method == "POST"
	input.request.path[2] == "approve"
}

expense := data.expenses[input.request.path[1]]

roles := {role | some role in token.roles}

grants contains {"id": "read-own", "message": "Employees can read their own expenses."} if {
	action == "read"
	expense.owner == token.sub
}

grants contains {"id": "read-team", "message": "Managers can read the expenses of their department."} if {
	action == "read"
	"manager" in roles
	expense.department == token.department
}

grants contains {"id": "read-finance", "message": "Finance can read every expense."} if {
	action == "read"
	"finance" in roles
}

grants contains {"id": "read-service", "message": "Services with the scope expenses:read can read expenses."} if {
	action == "read"
	"expenses:read" in split(token.scope, " ")
}

grants contains {"id": "approve-manager", "message": "Managers can approve expenses of their department up to their limit."} if {
	action == "approve"
	"manager" in roles
	expense.department == token.department
	expense.amount <= data.limits.manager
}

grants contains {"id": "approve-finance", "message": "Finance can approve expenses of any amount."} if {
	action == "approve"
	"finance" in roles
}

denies contains {"id": "audience", "message": "The token was not issued for this API."} if {
	token.aud != "expenses-api"
}

denies contains {"id": "unknown", "message": "There is no expense with this id."} if {
	not expense
}

denies contains {"id": "own-approval", "message": "Nobody can approve their own expense."} if {
	action == "approve"
	expense.owner == token.sub
}

denies contains {"id": "not-submitted", "message": "Only submitted expenses can be approved."} if {
	action == "approve"
	expense.status != "submitted"
}

denies contains {
	"id": "manager-limit",
	"message": sprintf("Over the manager limit of %d EUR, so Finance has to approve it.", [data.limits.manager]),
} if {
	action == "approve"
	"manager" in roles
	not "finance" in roles
	expense.amount > data.limits.manager
}

denies contains {
	"id": "needs-mfa",
	"message": sprintf("Approving more than %d EUR needs a sign-in with MFA.", [data.limits.mfa]),
} if {
	action == "approve"
	expense.amount > data.limits.mfa
	not "mfa" in token.amr
}

default allow := false

allow if {
	count(grants) > 0
	count(denies) == 0
}

decision := {
	"allow": allow,
	"grants": grants,
	"denies": denies,
}
